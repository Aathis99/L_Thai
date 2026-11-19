import importlib.util
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch
from types import SimpleNamespace

spec = importlib.util.spec_from_file_location('employee_extract', Path(__file__).parents[1] / 'scripts/extract-employees.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class ExtractionTest(unittest.TestCase):
    def test_extract_preserves_multiword_parts_and_emits_structured_payload(self):
        headers = {0:'ลำดับ',1:'คำนำหน้า',2:'ชื่อ',3:'นามสุกล',10:'เบอร์โทรติดต่อ'}
        def value(r,c):
            if r==0:return headers.get(c,'')
            if r==1:return ''
            return {0:r-1,1:'นาย',2:'FIRST  MIDDLE',3:f'FAMILY {r}',10:'081-2345678'}.get(c,'')
        sheet=SimpleNamespace(nrows=38,ncols=13,cell_value=value,
            cell=lambda r,c:SimpleNamespace(ctype=module.xlrd.XL_CELL_TEXT,value=value(r,c)))
        book=SimpleNamespace(sheet_by_name=lambda name:sheet,release_resources=lambda:None)
        with TemporaryDirectory() as directory:
            source=Path(directory)/'source.xls';source.write_bytes(b'synthetic')
            with patch.object(module.xlrd,'open_workbook',return_value=book):
                payload=module.extract(source)
        self.assertEqual(len(payload['employees']),36)
        first=payload['employees'][0]
        self.assertNotIn('name',first)
        self.assertEqual(first['prefix'],'นาย')
        self.assertEqual(first['first_name'],'FIRST MIDDLE')
        self.assertEqual(first['last_name'],'FAMILY 2')

if __name__=='__main__':unittest.main()
