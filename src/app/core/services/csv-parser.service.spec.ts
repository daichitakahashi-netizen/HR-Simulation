import { TestBed } from '@angular/core/testing';
import { CsvParserService } from './csv-parser.service';

describe('CsvParserService', () => {
  let service: CsvParserService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(CsvParserService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('parseEmployeesCsv', () => {
    it('should parse basic CSV data', () => {
      const csvData = `社員番号,営業力,管理力,開拓力,育成力,人件費
E001,75,46,63,40,6.7
E002,85,67,59,42,9.9`;

      const result = service.parseEmployeesCsv(csvData);

      expect(result.length).toBe(2);
      expect(result[0]).toEqual({
        id: 'E001',
        sales: 75,
        management: 46,
        development: 63,
        nurture: 40,
        personnelCost: 6.7,
      });
      expect(result[1]).toEqual({
        id: 'E002',
        sales: 85,
        management: 67,
        development: 59,
        nurture: 42,
        personnelCost: 9.9,
      });
    });

    it('should skip empty lines', () => {
      const csvData = `社員番号,営業力,管理力,開拓力,育成力,人件費
E001,75,46,63,40,6.7

E002,85,67,59,42,9.9`;

      const result = service.parseEmployeesCsv(csvData);

      expect(result.length).toBe(2);
    });

    it('should skip rows with missing columns', () => {
      const csvData = `社員番号,営業力,管理力,開拓力,育成力,人件費
E001,75,46,63
E002,85,67,59,42,9.9`;

      const result = service.parseEmployeesCsv(csvData);

      expect(result.length).toBe(1);
      expect(result[0].id).toBe('E002');
    });

    it('should skip rows with invalid numbers', () => {
      const csvData = `社員番号,営業力,管理力,開拓力,育成力,人件費
E001,abc,46,63,40,6.7
E002,85,67,59,42,9.9`;

      const result = service.parseEmployeesCsv(csvData);

      expect(result.length).toBe(1);
      expect(result[0].id).toBe('E002');
    });

    it('should validate ability ranges (0-100)', () => {
      const csvData = `社員番号,営業力,管理力,開拓力,育成力,人件費
E001,101,46,63,40,6.7
E002,75,-1,63,40,6.7
E003,75,46,101,40,6.7
E004,75,46,63,-1,6.7
E005,85,67,59,42,9.9`;

      const result = service.parseEmployeesCsv(csvData);

      // Only E005 should be valid
      expect(result.length).toBe(1);
      expect(result[0].id).toBe('E005');
    });

    it('should validate personnel cost range (1-20)', () => {
      const csvData = `社員番号,営業力,管理力,開拓力,育成力,人件費
E001,75,46,63,40,0.5
E002,75,46,63,40,20.5
E003,85,67,59,42,9.9`;

      const result = service.parseEmployeesCsv(csvData);

      // Only E003 should be valid
      expect(result.length).toBe(1);
      expect(result[0].id).toBe('E003');
    });

    it('should handle trailing/leading whitespace', () => {
      const csvData = `社員番号,営業力,管理力,開拓力,育成力,人件費
  E001  , 75 , 46 , 63 , 40 , 6.7
E002,85,67,59,42,9.9`;

      const result = service.parseEmployeesCsv(csvData);

      expect(result.length).toBe(2);
      expect(result[0].id).toBe('E001');
      expect(result[0].sales).toBe(75);
    });

    it('should handle float personnel costs', () => {
      const csvData = `社員番号,営業力,管理力,開拓力,育成力,人件費
E001,75,46,63,40,6.7
E002,85,67,59,42,12.345`;

      const result = service.parseEmployeesCsv(csvData);

      expect(result.length).toBe(2);
      expect(result[0].personnelCost).toBe(6.7);
      expect(result[1].personnelCost).toBe(12.345);
    });

    it('should return empty array for header only', () => {
      const csvData = `社員番号,営業力,管理力,開拓力,育成力,人件費`;

      const result = service.parseEmployeesCsv(csvData);

      expect(result.length).toBe(0);
    });

    it('should skip rows with empty id', () => {
      const csvData = `社員番号,営業力,管理力,開拓力,育成力,人件費
,75,46,63,40,6.7
E002,85,67,59,42,9.9`;

      const result = service.parseEmployeesCsv(csvData);

      expect(result.length).toBe(1);
      expect(result[0].id).toBe('E002');
    });
  });
});
