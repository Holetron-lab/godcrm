import time
import unittest
from core import staging_session


class SessionTests(unittest.TestCase):
    def base(self):
        return dict(origin='https://dev.godcrm.ai',database='godcrm_test',expires_at=int(time.time()*1000)+300000,read_only=True,storageState=dict(cookies=[],origins=[dict(origin='https://dev.godcrm.ai',localStorage=[])]))
    def test_session_scope(self):
        self.assertEqual(staging_session(self.base())['database'],'godcrm_test')
    def test_production_storage_rejected(self):
        value=self.base();value['storageState']['origins'][0]['origin']='https://app.godcrm.ai'
        with self.assertRaises(ValueError):staging_session(value)
    def test_parent_domain_cookie_rejected(self):
        value=self.base();value['storageState']['cookies']=[dict(domain='.godcrm.ai',secure=True)]
        with self.assertRaises(ValueError):staging_session(value)
    def test_session_expiry_caps_run(self):
        value=self.base()
        with self.assertRaises(ValueError):staging_session(value,value['expires_at']+1)
    def test_writable_session_rejected(self):
        value=self.base();value['read_only']=False
        with self.assertRaises(ValueError):staging_session(value)


if __name__=='__main__':unittest.main()
