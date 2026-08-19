import { TestBed } from '@angular/core/testing';
import { SimulationEngineService } from './simulation-engine.service';
import { Employee } from '../models/simulation.model';

describe('SimulationEngineService - Hungarian Algorithm', () => {
  let service: SimulationEngineService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(SimulationEngineService);
  });

  function createMockEmployees(count: number): Employee[] {
    const employees: Employee[] = [];
    for (let i = 0; i < count; i++) {
      employees.push({
        id: `emp-${i}`,
        sales: 50 + (i % 40),
        management: 40 + (i % 30),
        development: 60 + (i % 30),
        nurture: 30 + (i % 25),
        personnelCost: 5 + (i % 12),
      });
    }
    return employees;
  }

  describe('Basic service methods', () => {
    it('should calculate employee contribution correctly', () => {
      const employee: Employee = {
        id: 'test',
        sales: 100,
        management: 80,
        development: 60,
        nurture: 40,
        personnelCost: 10,
      };

      const contribA = service.calculateEmployeeContribution(employee, 'A');
      const expectedA = 100 * 0.45 + 80 * 0.35 + 60 * 0.1 + 40 * 0.1;
      expect(contribA).toBeCloseTo(expectedA, 5);

      const contribC = service.calculateEmployeeContribution(employee, 'C');
      const expectedC = 100 * 0.2 + 80 * 0.1 + 60 * 0.5 + 40 * 0.2;
      expect(contribC).toBeCloseTo(expectedC, 5);
    });

    it('should calculate department capability correctly', () => {
      const employees: Employee[] = [
        {
          id: 'emp1',
          sales: 100,
          management: 100,
          development: 100,
          nurture: 100,
          personnelCost: 10,
        },
        {
          id: 'emp2',
          sales: 50,
          management: 50,
          development: 50,
          nurture: 50,
          personnelCost: 5,
        },
      ];

      const capability = service.calculateDepartmentCapability(employees, 'A');
      const contrib1 = service.calculateEmployeeContribution(employees[0], 'A');
      const contrib2 = service.calculateEmployeeContribution(employees[1], 'A');
      expect(capability).toBeCloseTo(contrib1 + contrib2, 5);
    });

    it('should calculate base revenue correctly', () => {
      const capability = 100;
      const baseRevenueA = service.calculateBaseRevenue(capability, 'A');
      const expectedA = 10 * (1 + (100 / 100) * 0.06);
      expect(baseRevenueA).toBeCloseTo(expectedA, 5);

      const baseRevenueC = service.calculateBaseRevenue(capability, 'C');
      const expectedC = 2 * (1 + (100 / 100) * 0.25);
      expect(baseRevenueC).toBeCloseTo(expectedC, 5);
    });

    it('should calculate fulfillment rate correctly', () => {
      expect(service.calculateFulfillmentRate(100, 100)).toBeCloseTo(1.0, 5);
      expect(service.calculateFulfillmentRate(90, 100)).toBeCloseTo(0.9, 5);
      expect(service.calculateFulfillmentRate(120, 100)).toBeCloseTo(1.2, 5);
      expect(service.calculateFulfillmentRate(10, 0)).toBe(0);
    });

    it('should calculate shortage coefficients correctly', () => {
      expect(service.getShortageCoefficient(1.0, 'A')).toBe(1.0);
      expect(service.getShortageCoefficient(0.9, 'A')).toBe(0.85);
      expect(service.getShortageCoefficient(0.8, 'A')).toBe(0.7);
    });

    it('should calculate surplus coefficients correctly', () => {
      expect(service.getSurplusCoefficient(1.0)).toBe(1.0);
      expect(service.getSurplusCoefficient(1.2)).toBe(1.0);
      expect(service.getSurplusCoefficient(1.5)).toBe(0.9);
      expect(service.getSurplusCoefficient(1.8)).toBe(0.8);
    });

    it('should calculate cost correctly', () => {
      const personnelCosts = [5, 10, 8];
      const expectedCost = (23 * 3) / 100;
      expect(service.calculateCost(personnelCosts)).toBeCloseTo(expectedCost, 5);
    });
  });

  describe('Legacy simulate method', () => {
    it('should simulate allocation with provided mapping', () => {
      const employees = createMockEmployees(100);
      const allocation = { A: 40, B: 35, C: 25 };

      const result = service.simulate(employees, allocation, 100);

      expect(result.allocation['A']).toBe(40);
      expect(result.allocation['B']).toBe(35);
      expect(result.allocation['C']).toBe(25);
      expect(result.summary.totalRevenue).toBeGreaterThan(0);
      expect(result.summary.totalCost).toBeGreaterThan(0);
    });

    it('should calculate profit correctly in simulation', () => {
      const employees = createMockEmployees(100);
      const allocation = { A: 40, B: 35, C: 25 };

      const result = service.simulate(employees, allocation, 100);

      for (const dept of ['A', 'B', 'C']) {
        const deptResult = result.department[dept];
        const expectedProfit = deptResult.finalRevenue - deptResult.cost;
        expect(deptResult.profit).toBeCloseTo(expectedProfit, 5);
      }
    });
  });

  describe('simulateWithAllocation method', () => {
    it('should simulate allocation with employee ID mapping', () => {
      const employees = createMockEmployees(100);
      const allocatedIds: Record<string, string[]> = {
        A: employees.slice(0, 40).map(e => e.id),
        B: employees.slice(40, 75).map(e => e.id),
        C: employees.slice(75, 100).map(e => e.id),
      };

      const result = service.simulateWithAllocation(employees, allocatedIds, 100);

      expect(result.allocation['A']).toBe(40);
      expect(result.allocation['B']).toBe(35);
      expect(result.allocation['C']).toBe(25);
      expect(result.summary.totalRevenue).toBeGreaterThan(0);
    });

    it('should sum department results in summary', () => {
      const employees = createMockEmployees(100);
      const allocatedIds: Record<string, string[]> = {
        A: employees.slice(0, 40).map(e => e.id),
        B: employees.slice(40, 75).map(e => e.id),
        C: employees.slice(75, 100).map(e => e.id),
      };

      const result = service.simulateWithAllocation(employees, allocatedIds, 100);

      const sumRevenue =
        result.department['A'].finalRevenue +
        result.department['B'].finalRevenue +
        result.department['C'].finalRevenue;

      const sumCost =
        result.department['A'].cost +
        result.department['B'].cost +
        result.department['C'].cost;

      expect(result.summary.totalRevenue).toBeCloseTo(sumRevenue, 5);
      expect(result.summary.totalCost).toBeCloseTo(sumCost, 5);
    });

    it('should respect min headcount constraints', () => {
      const employees = createMockEmployees(100);
      const allocatedIds: Record<string, string[]> = {
        A: employees.slice(0, 30).map(e => e.id),
        B: employees.slice(30, 50).map(e => e.id),
        C: employees.slice(50, 100).map(e => e.id),
      };

      const result = service.simulateWithAllocation(employees, allocatedIds, 100);

      expect(result.allocation['A']).toBeGreaterThanOrEqual(30);
      expect(result.allocation['B']).toBeGreaterThanOrEqual(20);
      expect(result.allocation['C']).toBeGreaterThanOrEqual(10);
    });
  });

  describe('optimal simulation (Hungarian algorithm)', () => {
    it(
      'should generate valid allocation with optimal solution',
      () => {
        const employees = createMockEmployees(100);
        const result = service.runOptimalSimulation(
          employees,
          'totalRevenue',
          100
        );

        expect(result.allocation['A']).toBeGreaterThanOrEqual(30);
        expect(result.allocation['B']).toBeGreaterThanOrEqual(20);
        expect(result.allocation['C']).toBeGreaterThanOrEqual(10);
        expect(result.allocation['A'] + result.allocation['B'] + result.allocation['C']).toBe(100);
        expect(result.summary.totalRevenue).toBeGreaterThan(0);

        const allAllocated = new Set<string>();
        for (const dept of ['A', 'B', 'C']) {
          const ids = result.department[dept].allocatedEmployeeIds;
          for (const id of ids) {
            expect(allAllocated.has(id)).toBe(false);
            allAllocated.add(id);
          }
        }
        expect(allAllocated.size).toBe(100);
      },
      60000
    );

    it(
      'should handle locked employee constraints',
      () => {
        const employees = createMockEmployees(100);
        const locked: Record<string, string> = {
          [employees[0].id]: 'A',
          [employees[1].id]: 'B',
        };

        const result = service.runOptimalSimulation(
          employees,
          'totalRevenue',
          100,
          locked
        );

        expect(result.department['A'].allocatedEmployeeIds).toContain(employees[0].id);
        expect(result.department['B'].allocatedEmployeeIds).toContain(employees[1].id);
      },
      60000
    );
  });

  describe('Penalty calculations', () => {
    it('should apply shortage and surplus penalties in simulation', () => {
      const employees = createMockEmployees(100);
      const result = service.simulate(employees, { A: 40, B: 35, C: 25 }, 100);

      for (const dept of ['A', 'B', 'C']) {
        const deptResult = result.department[dept];
        expect(deptResult.finalRevenue).toBeLessThanOrEqual(deptResult.baseRevenue);
        expect(deptResult.shortageCoefficient).toBeGreaterThan(0);
        expect(deptResult.surplusCoefficient).toBeGreaterThan(0);
      }
    });
  });

  describe('Previous year revenue constraint', () => {
    it('should set flag when revenue below 58B', () => {
      const employees = createMockEmployees(100);
      const result = service.simulate(employees, { A: 40, B: 35, C: 25 }, 100);

      if (result.summary.totalRevenue < 58) {
        expect(result.summary.isBelowPreviousYearRevenue).toBe(true);
      } else {
        expect(result.summary.isBelowPreviousYearRevenue).toBe(false);
      }
    });
  });
});
