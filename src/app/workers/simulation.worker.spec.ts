import { OptimalSimulationEngine } from './simulation.worker';
import { CsvParserService } from '../core/services/csv-parser.service';
import { Employee } from '../core/models/simulation.model';

// human_resources_100.csv (src/assets/human_resources_100.csv) の内容をそのまま埋め込み、
// 課題1〜4の既存計算精度を固定するための回帰テストとして利用する。
const HUMAN_RESOURCES_100_CSV = `社員番号,営業力,管理力,開拓力,育成力,人件費
E001,75,46,63,40,6.7
E002,85,67,59,42,9.9
E003,89,48,59,44,9.1
E004,85,44,53,29,8.0
E005,77,54,54,36,6.0
E006,96,72,56,57,7.3
E007,93,67,64,33,8.0
E008,80,74,48,41,5.8
E009,74,54,63,45,7.6
E010,78,70,40,50,6.7
E011,77,59,67,48,9.7
E012,73,72,34,30,7.5
E013,98,37,56,61,6.0
E014,97,67,59,49,6.7
E015,77,45,30,34,5.6
E016,94,44,56,60,7.9
E017,82,39,48,54,6.0
E018,93,50,50,51,6.4
E019,78,62,57,59,9.5
E020,85,44,56,29,8.0
E021,92,51,40,31,5.7
E022,94,46,35,28,8.2
E023,94,72,64,46,6.8
E024,90,64,53,43,7.5
E025,98,66,68,65,7.4
E026,88,38,64,40,5.8
E027,89,44,63,28,8.0
E028,78,44,67,29,8.7
E029,98,64,62,63,7.0
E030,92,51,67,59,8.4
E031,81,54,65,41,6.0
E032,91,53,45,36,6.6
E033,98,55,30,56,8.9
E034,76,45,34,26,5.1
E035,74,37,70,48,5.4
E036,33,95,36,41,5.0
E037,38,95,27,67,5.9
E038,41,75,25,55,7.6
E039,40,79,55,36,7.9
E040,31,83,30,38,6.8
E041,46,77,49,67,5.6
E042,38,84,52,58,5.4
E043,48,79,65,64,6.3
E044,51,76,27,55,6.8
E045,49,90,39,40,7.5
E046,48,72,28,47,5.4
E047,58,95,39,72,9.2
E048,31,98,35,60,7.9
E049,66,89,52,50,6.6
E050,63,93,61,41,9.3
E051,35,93,60,45,7.7
E052,69,96,37,65,7.4
E053,57,94,50,43,8.4
E054,69,98,36,52,6.5
E055,43,87,35,48,7.1
E056,52,83,54,47,7.7
E057,49,72,28,65,8.3
E058,67,75,36,52,9.0
E059,64,94,51,63,6.8
E060,63,98,40,59,6.5
E061,64,57,89,60,6.7
E062,50,39,97,57,9.0
E063,56,60,87,39,7.0
E064,63,49,78,50,5.7
E065,58,25,75,41,6.0
E066,60,37,87,64,7.0
E067,64,35,78,70,8.5
E068,41,48,80,64,6.3
E069,63,35,90,64,7.7
E070,63,60,72,51,6.6
E071,46,38,93,33,7.1
E072,63,43,72,60,7.2
E073,45,57,74,70,9.6
E074,70,64,90,70,7.4
E075,44,52,82,67,7.3
E076,39,35,77,57,7.8
E077,47,57,84,61,9.2
E078,63,46,85,60,5.9
E079,66,60,92,30,6.6
E080,47,58,89,64,9.5
E081,35,56,83,54,7.2
E082,51,30,95,41,6.6
E083,73,26,94,63,6.2
E084,54,40,72,48,6.6
E085,41,30,73,67,5.0
E086,63,74,46,86,9.4
E087,62,43,36,73,8.6
E088,65,62,30,95,6.0
E089,31,60,62,87,5.8
E090,56,53,47,96,9.6
E091,35,61,51,74,8.2
E092,58,36,58,73,7.1
E093,29,74,61,85,9.3
E094,57,35,55,89,7.7
E095,33,67,63,86,7.4
E096,31,62,34,83,6.4
E097,40,36,33,80,5.0
E098,39,74,57,95,9.2
E099,54,35,54,76,6.1
E100,53,75,36,87,9.4`;

describe('simulation.worker (OptimalSimulationEngine) - regression', () => {
  let engine: OptimalSimulationEngine;
  let employees: Employee[];

  beforeAll(() => {
    engine = new OptimalSimulationEngine();
    employees = new CsvParserService().parseEmployeesCsv(HUMAN_RESOURCES_100_CSV);
  });

  it('parses exactly 100 employees from the fixture CSV', () => {
    expect(employees.length).toBe(100);
  });

  it(
    '課題1: 全社売上最大化 -> A=40, B=40, C=20',
    () => {
      const result = engine.runOptimalSimulation(employees, 'totalRevenue', 100);

      expect(result.allocation['A']).toBe(40);
      expect(result.allocation['B']).toBe(40);
      expect(result.allocation['C']).toBe(20);
      expect(result.summary.totalRevenue).toBeGreaterThanOrEqual(58);
    },
    60000
  );

  it(
    '課題2: A事業部利益最大化 -> A=48',
    () => {
      const result = engine.runOptimalSimulation(employees, 'departmentAProfitMaximize', 100);

      expect(result.allocation['A']).toBe(48);
    },
    60000
  );

  it(
    '課題3: B事業部売上最大化 -> B=49 (human_resources_100.csv での既存アルゴリズムの実測最適解)',
    () => {
      const result = engine.runOptimalSimulation(employees, 'departmentBRevenueMaximize', 100);

      expect(result.allocation['B']).toBe(49);
    },
    60000
  );

  it(
    '課題4: C事業部売上最大化 -> C=28 (human_resources_100.csv での既存アルゴリズムの実測最適解)',
    () => {
      const result = engine.runOptimalSimulation(employees, 'departmentCRevenueMaximize', 100);

      expect(result.allocation['C']).toBe(28);
    },
    60000
  );
});

describe('simulation.worker (OptimalSimulationEngine) - employee satisfaction objective', () => {
  let engine: OptimalSimulationEngine;
  let employees: Employee[];

  beforeAll(() => {
    engine = new OptimalSimulationEngine();
    employees = new CsvParserService().parseEmployeesCsv(HUMAN_RESOURCES_100_CSV);
  });

  it(
    'maximizes preference matches first, keeps a valid full allocation, and honors the revenue floor',
    () => {
      const withPreferences: Employee[] = employees.map((emp, index) => ({
        ...emp,
        preference: (['A', 'B', 'C', 'NONE'] as const)[index % 4],
      }));

      const result = engine.runSatisfactionSimulation(withPreferences, 100, 'totalRevenue');

      const total = result.allocation['A'] + result.allocation['B'] + result.allocation['C'];
      expect(total).toBe(100);
      expect(result.allocation['A']).toBeGreaterThanOrEqual(30);
      expect(result.allocation['B']).toBeGreaterThanOrEqual(20);
      expect(result.allocation['C']).toBeGreaterThanOrEqual(10);
      expect(result.summary.totalRevenue).toBeGreaterThanOrEqual(58);
    },
    60000
  );

  it('does not mutate an employee base ability value when applying the preference bonus', () => {
    const withPreferences: Employee[] = employees.map((emp, index) => ({
      ...emp,
      preference: index === 0 ? 'A' : 'NONE',
    }));
    const original = { ...withPreferences[0] };

    engine.runSatisfactionSimulation(withPreferences, 100, 'totalRevenue');

    expect(withPreferences[0].sales).toBe(original.sales);
    expect(withPreferences[0].management).toBe(original.management);
    expect(withPreferences[0].development).toBe(original.development);
    expect(withPreferences[0].nurture).toBe(original.nurture);
  }, 60000);
});
