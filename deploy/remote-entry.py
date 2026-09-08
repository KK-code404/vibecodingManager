#!/usr/bin/python3
"""Root-owned forced SSH command. No shell interpolation and no user-provided paths."""
import fcntl
import json
import os
import re
import select
import shutil
import signal
import subprocess
import sys
import time
import urllib.request

DOCKER = '/usr/bin/docker'
CONFIG = '/etc/vibecoding-manager/projects.json'
ENV = {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LANG': 'C.UTF-8', 'HOME': '/root'}

def run(args, timeout=15):
    # Communicate incrementally so noisy logs cannot exhaust memory before truncation.
    p = subprocess.Popen([DOCKER, *args], stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=ENV)
    deadline = time.monotonic() + timeout
    output, errors = bytearray(), bytearray()
    pipes = {p.stdout: output, p.stderr: errors}
    try:
        while pipes:
            if time.monotonic() > deadline:
                raise RuntimeError('Docker command timed out')
            ready, _, _ = select.select(list(pipes), [], [], .1)
            for pipe in ready:
                chunk = os.read(pipe.fileno(), 8192)
                if not chunk:
                    del pipes[pipe]
                else:
                    pipes[pipe].extend(chunk)
                    if len(output) + len(errors) > 700000:
                        raise RuntimeError('Docker output exceeded limit')
        if p.wait(timeout=1) != 0:
            raise RuntimeError('Docker command failed: ' + errors.decode(errors='replace')[:300])
        return output.decode(errors='replace')
    finally:
        if p.poll() is None:
            p.kill()
        p.wait()

def containers(config):
    ids = run(['ps', '-aq', '--filter', 'label=com.docker.compose.project=' + config['composeProject']]).split()
    result = {}
    if not ids:
        return result
    for item in json.loads(run(['inspect', *ids])):
        labels = item.get('Config', {}).get('Labels', {}) or {}
        service = labels.get('com.docker.compose.service')
        if labels.get('com.docker.compose.project') != config['composeProject'] or service not in config['services']:
            continue
        if labels.get('com.docker.compose.oneoff', '').lower() == 'true':
            continue
        if service in result:
            raise RuntimeError('Multiple containers for service; scaling is not supported: ' + service)
        result[service] = item
    return result

def state(config):
    found = containers(config)
    stats = {}
    running = [v['Id'] for v in found.values() if v['State']['Running']]
    if running:
        for line in run(['stats', '--no-stream', '--format', '{{json .}}', *running]).splitlines():
            s = json.loads(line)
            stats[s['ID']] = s
    services = []
    for name in config['services']:
        c = found.get(name)
        s = next((v for k, v in stats.items() if c and c['Id'].startswith(k)), {})
        services.append({'service': name, 'state': c['State']['Status'] if c else 'missing', 'health': c['State'].get('Health', {}).get('Status') if c else None,
                         'cpu': s.get('CPUPerc'), 'memory': s.get('MemUsage'), 'restarts': c.get('RestartCount') if c else None})
    controlled = config['controlledServices']
    count = sum(bool(found.get(n, {}).get('State', {}).get('Running')) for n in controlled)
    runtime = 'unknown' if any(n not in found for n in controlled) else 'running' if count == len(controlled) else 'partial' if count else 'stopped'
    return {'composeProject': config['composeProject'], 'controlledServices': controlled, 'runtime': runtime, 'services': services}

def host_metrics():
    def cpu():
        with open('/proc/stat') as f:
            v = list(map(int, f.readline().split()[1:9]))
        return sum(v), v[3] + v[4]
    first = cpu()
    time.sleep(.25)
    second = cpu()
    with open('/proc/meminfo') as f:
        memory = {line.split(':')[0]: int(line.split()[1]) for line in f}
    disk = shutil.disk_usage('/')
    return {'cpu': round(100 * (1 - (second[1]-first[1]) / max(1, second[0]-first[0])), 1),
            'memoryPercent': round(100 * (1-memory['MemAvailable']/memory['MemTotal']), 1),
            'diskPercent': round(100*disk.used/disk.total, 1), 'diskUsed': disk.used, 'diskTotal': disk.total}

def graceful_stop(container_id, seconds):
    # docker stop -t N sends SIGKILL after N seconds. This entry deliberately does not.
    current = json.loads(run(['inspect', container_id]))[0]
    if not current['State']['Running']:
        return
    run(['kill', '--signal=SIGTERM', container_id])
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if not json.loads(run(['inspect', container_id]))[0]['State']['Running']:
            return
        time.sleep(1)
    raise RuntimeError('Graceful shutdown timed out; container was not force killed')

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None

def wait_ready(config, found):
    check = config.get('readiness')
    if not check:
        raise RuntimeError('Root configuration requires a readiness check')
    deadline = time.monotonic() + 40
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect)
    while time.monotonic() < deadline:
        try:
            if check['type'] == 'container':
                c = json.loads(run(['inspect', found[check['service']]['Id']]))[0]
                if c['State'].get('Health', {}).get('Status') == 'healthy':
                    return
            else:
                with opener.open(check['url'], timeout=3) as r:
                    if 200 <= r.status < 300:
                        return
        except (OSError, RuntimeError):
            pass
        time.sleep(1)
    raise RuntimeError('Readiness check timed out; subsequent services were not started')

def control(config, operation):
    found = containers(config)
    for name in config['services']:
        if name not in found:
            raise RuntimeError('Missing container; deploy manually: ' + name)
    completed = []
    try:
        if operation in ('stop', 'restart'):
            for name in config['stopOrder']:
                graceful_stop(found[name]['Id'], 120 if name == 'worker' else 15)
                completed.append('stopped ' + name)
        if operation in ('start', 'restart'):
            for name in config.get('dependencies', []):
                s = json.loads(run(['inspect', found[name]['Id']]))[0]['State']
                if not s['Running'] or s.get('Health', {}).get('Status') != 'healthy':
                    raise RuntimeError('Dependency must have a passing Docker healthcheck: ' + name)
            for name in config['startOrder']:
                run(['start', found[name]['Id']])
                completed.append('started ' + name)
                if name == config.get('readyAfter'):
                    wait_ready(config, found)
        result = state(config)
        expected = 'stopped' if operation == 'stop' else 'running'
        if result['runtime'] != expected:
            raise RuntimeError('Final container state does not match requested operation')
        return {'completed': completed, 'state': result}
    except Exception as e:
        raise RuntimeError(json.dumps({'completed': completed, 'error': str(e)}, ensure_ascii=False)) from e

def validate_config(config):
    for key, p in config.items():
        if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]{0,63}', key):
            raise RuntimeError('Invalid project identifier')
        controlled = p['controlledServices']
        if not controlled or len(set(controlled)) != len(controlled) or not set(controlled) <= set(p['services']):
            raise RuntimeError('Invalid controlled services')
        for order in ('startOrder', 'stopOrder'):
            if sorted(p[order]) != sorted(controlled):
                raise RuntimeError('Control order must contain each allowed service exactly once')
        if set(p.get('dependencies', [])) & set(controlled):
            raise RuntimeError('Dependencies must be read only')
    return config

def dispatch(config, request):
    operation = request.get('operation')
    if operation == 'status' and set(request) == {'operation'}:
        return {'host': host_metrics(), 'projects': {k: state(p) for k, p in config.items()}}
    project = request.get('project')
    if project not in config:
        raise RuntimeError('Project not in root allowlist')
    p = config[project]
    if operation == 'logs' and set(request) <= {'operation', 'project', 'service', 'lines'}:
        service, lines = request.get('service'), request.get('lines', 200)
        if service not in p['services'] or type(lines) is not int or not 1 <= lines <= 1000:
            raise RuntimeError('Invalid log request')
        found = containers(p)
        if service not in found:
            raise RuntimeError('Container missing')
        # Docker logs writes stderr too. The dedicated log branch combines both streams.
        return {'text': log_output(found[service]['Id'], lines)}
    if operation not in ('start', 'stop', 'restart') or set(request) != {'operation', 'project'}:
        raise RuntimeError('Operation not permitted')
    os.makedirs('/run/vibecoding-manager', mode=0o700, exist_ok=True)
    with open('/run/vibecoding-manager/' + project + '.lock', 'w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        return control(p, operation)

def log_output(container_id, lines):
    p = subprocess.Popen([DOCKER, 'logs', '--tail', str(lines), '--timestamps', container_id], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, env=ENV)
    out = bytearray()
    deadline = time.monotonic() + 10
    try:
        while time.monotonic() < deadline:
            if select.select([p.stdout], [], [], .1)[0]:
                chunk = os.read(p.stdout.fileno(), 8192)
                if not chunk:
                    break
                out.extend(chunk)
                if len(out) > 500000:
                    out = out[:500000] + b'\n[truncated]'
                    break
        return out.decode(errors='replace')
    finally:
        if p.poll() is None:
            p.kill()
        p.wait()

def main():
    signal.alarm(230)
    stat = os.stat(CONFIG)
    if stat.st_uid != 0 or stat.st_mode & 0o022:
        raise RuntimeError('Configuration must be root owned and not writable by group/others')
    with open(CONFIG) as f:
        config = validate_config(json.load(f))
    raw = sys.stdin.buffer.readline(8193)
    if len(raw) > 8192:
        raise RuntimeError('Request too large')
    request = json.loads(raw)
    if not isinstance(request, dict):
        raise RuntimeError('Invalid request')
    print(json.dumps(dispatch(config, request), ensure_ascii=False))

if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(json.dumps({'error': str(error)}, ensure_ascii=False))
        sys.exit(1)
