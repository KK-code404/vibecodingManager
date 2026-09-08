#!/usr/bin/env python3
"""Explicitly run only on a disposable Linux Docker test host."""
import importlib.util
import json
import pathlib
import subprocess

root = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location('remote', root / 'remote-entry.py')
remote = importlib.util.module_from_spec(spec)
spec.loader.exec_module(remote)
compose = ['docker', 'compose', '-p', 'vcm-control-test', '-f', str(root / 'fixtures/compose.yaml')]
config = json.loads((root / 'projects.example.json').read_text())['oilorder']
config['composeProject'] = 'vcm-control-test'
try:
    subprocess.run([*compose, 'up', '-d', '--wait'], check=True)
    original = remote.containers(config)
    remote.control(config, 'stop')
    assert remote.state(config)['runtime'] == 'stopped'
    remote.control(config, 'start')
    assert remote.state(config)['runtime'] == 'running'
    remote.control(config, 'restart')
    final = remote.containers(config)
    for name in ['db', 'redis']:
        assert original[name]['Id'] == final[name]['Id']
        assert original[name]['State']['StartedAt'] == final[name]['State']['StartedAt']
    assert remote.log_output(final['api']['Id'], 20) is not None
    print('PASS: start / stop / restart, dependency preservation, logs')
finally:
    subprocess.run([*compose, 'down'], check=True)
