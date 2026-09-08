import importlib.util
import json
import pathlib
import sys
import unittest
from unittest.mock import patch
# Windows lacks fcntl; tests mock only locking. Linux integration checks actual flock.
if sys.platform == 'win32':
    from unittest.mock import MagicMock
    sys.modules['fcntl'] = MagicMock()
spec = importlib.util.spec_from_file_location('remote', pathlib.Path(__file__).parents[1] / 'remote-entry.py')
remote = importlib.util.module_from_spec(spec)
spec.loader.exec_module(remote)
CONFIG = json.loads((pathlib.Path(__file__).parents[1] / 'projects.example.json').read_text())

class RemoteTests(unittest.TestCase):
    def test_invalid_operation_and_service(self):
        for request in [{'operation':'shell','project':'oilorder'}, {'operation':'stop','project':'../../etc'}, {'operation':'logs','project':'oilorder','service':'db; id'}, {'operation':'logs','project':'oilorder','service':'api','lines':1001}]:
            with self.assertRaises(RuntimeError):
                remote.dispatch(CONFIG, request)

    def test_config_cannot_control_dependency(self):
        c = json.loads(json.dumps(CONFIG))
        c['oilorder']['dependencies'].append('api')
        with self.assertRaises(RuntimeError):
            remote.validate_config(c)

    def test_stop_order_and_no_dependency_mutation(self):
        found = {n:{'Id':n} for n in CONFIG['oilorder']['services']}
        with patch.object(remote,'containers',return_value=found), patch.object(remote,'graceful_stop') as stop, patch.object(remote,'state',return_value={'runtime':'stopped'}):
            remote.control(CONFIG['oilorder'],'stop')
            self.assertEqual([c.args[0] for c in stop.call_args_list], ['frontend','beat','worker','api'])
            self.assertEqual(stop.call_args_list[2].args[1], 120)

    def test_worker_timeout_aborts_before_api(self):
        found = {n:{'Id':n} for n in CONFIG['oilorder']['services']}
        def stop(name, timeout):
            if name == 'worker':
                raise RuntimeError('timeout')
        with patch.object(remote,'containers',return_value=found), patch.object(remote,'graceful_stop',side_effect=stop) as stopped:
            with self.assertRaises(RuntimeError):
                remote.control(CONFIG['oilorder'],'stop')
            self.assertEqual([c.args[0] for c in stopped.call_args_list], ['frontend','beat','worker'])

    def test_missing_container_never_created(self):
        with patch.object(remote,'containers',return_value={}), patch.object(remote,'run') as run:
            with self.assertRaises(RuntimeError):
                remote.control(CONFIG['oilorder'],'start')
            run.assert_not_called()

    def test_start_waits_for_api_before_worker(self):
        found = {n:{'Id':n} for n in CONFIG['oilorder']['services']}
        events = []
        def run(args):
            if args[0] == 'inspect':
                return json.dumps([{'State':{'Running':True,'Health':{'Status':'healthy'}}}])
            events.append(args)
        with patch.object(remote,'containers',return_value=found), patch.object(remote,'run',side_effect=run), patch.object(remote,'wait_ready',side_effect=lambda *args:events.append(['ready'])), patch.object(remote,'state',return_value={'runtime':'running'}):
            remote.control(CONFIG['oilorder'],'start')
        self.assertEqual(events,[['start','api'],['ready'],['start','worker'],['start','beat'],['start','frontend']])

if __name__ == '__main__':
    unittest.main()
