import { TestBed } from '@angular/core/testing';
import { SimulationEngineService } from './simulation-engine.service';
import { Employee } from '../models/simulation.model';

describe('SimulationEngineService', () => {
  let service: SimulationEngineService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(SimulationEngineService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('calculateEmployeeContribution', () => {
    it('should calculate employee contribution for department A', () => {
      const employee: Employee = {
        id: '1',
        sales: 100,
        management: 100,
        development: 100,
        nurture: 100,
        personnelCost: 10,
      };
      // A事業部: sales*0.45 + management*0.35 + development*0.10 + nurture*0.10
      // = 100*0.45 + 100*0.35 + 100*0.10 + 100*0.10 = 45 + 35 + 10 + 10 = 100
      const result = service.calculateEmployeeContribution(employee, 'A');
      expect(result).toBe(100);
    });

    it('should calculate employee contribution for department B', () => {
      const employee: Employee = {
        id: '1',
        sales: 100,
        management: 100,
        development: 100,
        nurture: 100,
        personnelCost: 10,
      };
      // B事業部: sales*0.35 + management*0.20 + development*0.30 + nurture*0.15
      // = 100*0.35 + 100*0.20 + 100*0.30 + 100*0.15 = 35 + 20 + 30 + 15 = 100
      const result = service.calculateEmployeeContribution(employee, 'B');
      expect(result).toBe(100);
    });

    it('should calculate employee contribution for department C', () => {
      const employee: Employee = {
        id: '1',
        sales: 100,
        management: 100,
        development: 100,
        nurture: 100,
        personnelCost: 10,
      };
      // C事業部: sales*0.20 + management*0.10 + development*0.50 + nurture*0.20
      // = 100*0.20 + 100*0.10 + 100*0.50 + 100*0.20 = 20 + 10 + 50 + 20 = 100
      const result = service.calculateEmployeeContribution(employee, 'C');
      expect(result).toBe(100);
    });

    it('should handle mixed ability values', () => {
      const employee: Employee = {
        id: '1',
        sales: 80,
        management: 60,
        development: 70,
        nurture: 90,
        personnelCost: 10,
      };
      // A事業部: 80*0.45 + 60*0.35 + 70*0.10 + 90*0.10 = 36 + 21 + 7 + 9 = 73
      const result = service.calculateEmployeeContribution(employee, 'A');
      expect(result).toBeCloseTo(73, 5);
    });
  });

  describe('calculateDepartmentCapability', () => {
    it('should sum contributions of all employees', () => {
      const employees: Employee[] = [
        {
          id: '1',
          sales: 50,
          management: 50,
          development: 50,
          nurture: 50,
          personnelCost: 10,
        },
        {
          id: '2',
          sales: 50,
          management: 50,
          development: 50,
          nurture: 50,
          personnelCost: 10,
        },
      ];
      // A事業部: (50*0.45 + 50*0.35 + 50*0.10 + 50*0.10) * 2 = 50 * 2 = 100
      const result = service.calculateDepartmentCapability(employees, 'A');
      expect(result).toBeCloseTo(100, 5);
    });

    it('should return 0 for empty employee list', () => {
      const employees: Employee[] = [];
      const result = service.calculateDepartmentCapability(employees, 'A');
      expect(result).toBe(0);
    });
  });

  describe('calculateBaseRevenue', () => {
    it('should calculate base revenue for department A', () => {
      // A: baseRevenue = 10 * (1 + (50/100) * 0.06) = 10 * 1.03 = 10.3
      const result = service.calculateBaseRevenue(50, 'A');
      expect(result).toBeCloseTo(10.3, 5);
    });

    it('should calculate base revenue for department B', () => {
      // B: baseRevenue = 7 * (1 + (100/100) * 0.12) = 7 * 1.12 = 7.84
      const result = service.calculateBaseRevenue(100, 'B');
      expect(result).toBeCloseTo(7.84, 5);
    });

    it('should calculate base revenue for department C', () => {
      // C: baseRevenue = 2 * (1 + (100/100) * 0.25) = 2 * 1.25 = 2.5
      const result = service.calculateBaseRevenue(100, 'C');
      expect(result).toBeCloseTo(2.5, 5);
    });
  });

  describe('calculateAppropriateHeadcount', () => {
    it('should calculate dynamic appropriate headcount for 100 employees', () => {
      // A: 40 * (100/100) = 40
      const result = service.calculateAppropriateHeadcount(100, 'A');
      expect(result).toBe(40);
    });

    it('should scale appropriate headcount for 110 employees', () => {
      // A: 40 * (110/100) = 44
      const result = service.calculateAppropriateHeadcount(110, 'A');
      expect(result).toBeCloseTo(44, 5);
    });

    it('should calculate for all departments', () => {
      const resultA = service.calculateAppropriateHeadcount(100, 'A');
      const resultB = service.calculateAppropriateHeadcount(100, 'B');
      const resultC = service.calculateAppropriateHeadcount(100, 'C');
      expect(resultA).toBe(40);
      expect(resultB).toBe(35);
      expect(resultC).toBe(25);
    });
  });

  describe('calculateFulfillmentRate', () => {
    it('should calculate fulfillment rate at 100%', () => {
      const result = service.calculateFulfillmentRate(40, 40);
      expect(result).toBeCloseTo(1.0, 5);
    });

    it('should calculate fulfillment rate at 50%', () => {
      const result = service.calculateFulfillmentRate(20, 40);
      expect(result).toBeCloseTo(0.5, 5);
    });

    it('should calculate fulfillment rate above 100%', () => {
      const result = service.calculateFulfillmentRate(50, 40);
      expect(result).toBeCloseTo(1.25, 5);
    });

    it('should handle zero appropriate headcount', () => {
      const result = service.calculateFulfillmentRate(10, 0);
      expect(result).toBe(0);
    });
  });

  describe('getShortageCoefficient', () => {
    it('should return 1.0 for 100% fulfillment (A)', () => {
      const result = service.getShortageCoefficient(1.0, 'A');
      expect(result).toBe(1.0);
    });

    it('should return 0.85 for 90-99% fulfillment (A)', () => {
      const result = service.getShortageCoefficient(0.95, 'A');
      expect(result).toBe(0.85);
    });

    it('should return 0.70 for 80-89% fulfillment (A)', () => {
      const result = service.getShortageCoefficient(0.85, 'A');
      expect(result).toBe(0.70);
    });

    it('should return 0.50 for 70-79% fulfillment (A)', () => {
      const result = service.getShortageCoefficient(0.75, 'A');
      expect(result).toBe(0.50);
    });

    it('should return 0.30 for <70% fulfillment (A)', () => {
      const result = service.getShortageCoefficient(0.5, 'A');
      expect(result).toBe(0.30);
    });

    it('should return 0.90 for 90-99% fulfillment (B)', () => {
      const result = service.getShortageCoefficient(0.95, 'B');
      expect(result).toBe(0.90);
    });

    it('should return 0.95 for 90-99% fulfillment (C)', () => {
      const result = service.getShortageCoefficient(0.95, 'C');
      expect(result).toBe(0.95);
    });
  });

  describe('getSurplusCoefficient', () => {
    it('should return 1.0 for <=120% fulfillment', () => {
      const result = service.getSurplusCoefficient(1.2);
      expect(result).toBe(1.0);
    });

    it('should return 0.95 for 120-140% fulfillment', () => {
      const result = service.getSurplusCoefficient(1.3);
      expect(result).toBe(0.95);
    });

    it('should return 0.90 for 140-160% fulfillment', () => {
      const result = service.getSurplusCoefficient(1.5);
      expect(result).toBe(0.90);
    });

    it('should return 0.80 for >160% fulfillment', () => {
      const result = service.getSurplusCoefficient(1.7);
      expect(result).toBe(0.80);
    });
  });

  describe('calculateCost', () => {
    it('should multiply personnel costs by 3', () => {
      const personnelCosts = [10, 5, 15];
      const result = service.calculateCost(personnelCosts);
      // (10 + 5 + 15) * 3 = 30 * 3 = 90
      expect(result).toBe(90);
    });

    it('should return 0 for empty array', () => {
      const result = service.calculateCost([]);
      expect(result).toBe(0);
    });
  });

  describe('calculateProfit', () => {
    it('should calculate profit correctly', () => {
      const result = service.calculateProfit(100, 30);
      expect(result).toBe(70);
    });

    it('should handle negative profit', () => {
      const result = service.calculateProfit(20, 30);
      expect(result).toBe(-10);
    });
  });

  describe('calculateDepartmentResult', () => {
    it('should calculate complete department result', () => {
      const employees: Employee[] = [
        {
          id: '1',
          sales: 100,
          management: 100,
          development: 100,
          nurture: 100,
          personnelCost: 10,
        },
      ];
      const result = service.calculateDepartmentResult(
        employees,
        1,
        'A',
        100
      );

      expect(result.allocatedEmployees).toBe(1);
      expect(result.departmentCapability).toBe(100);
      expect(result.appropriateHeadcount).toBe(40);
      expect(result.fulfillmentRate).toBeCloseTo(0.025, 5); // 1/40
      expect(result.shortageCoefficient).toBe(0.30);
      expect(result.surplusCoefficient).toBe(1.0);
      expect(result.personnelCosts).toEqual([10]);
      expect(result.cost).toBe(30); // 10 * 3
    });
  });

  describe('simulate', () => {
    it('should run complete simulation', () => {
      const employees: Employee[] = [
        {
          id: '1',
          sales: 100,
          management: 100,
          development: 100,
          nurture: 100,
          personnelCost: 10,
        },
        {
          id: '2',
          sales: 80,
          management: 80,
          development: 80,
          nurture: 80,
          personnelCost: 12,
        },
        {
          id: '3',
          sales: 90,
          management: 90,
          development: 90,
          nurture: 90,
          personnelCost: 11,
        },
      ];

      const allocation = {
        A: 1,
        B: 1,
        C: 1,
      };

      const result = service.simulate(employees, allocation, 100);

      expect(result).toBeTruthy();
      expect(result.department).toBeTruthy();
      expect(result.department['A']).toBeTruthy();
      expect(result.department['B']).toBeTruthy();
      expect(result.department['C']).toBeTruthy();
      expect(result.summary).toBeTruthy();
      expect(result.summary.totalRevenue).toBeGreaterThan(0);
      expect(result.summary.totalCost).toBeGreaterThan(0);
    });

    it('should sum department results to summary', () => {
      const employees: Employee[] = Array.from({ length: 50 }, (_, i) => ({
        id: `${i}`,
        sales: 50 + i,
        management: 50 + i,
        development: 50 + i,
        nurture: 50 + i,
        personnelCost: 5 + (i % 5),
      }));

      const allocation = {
        A: 20,
        B: 15,
        C: 15,
      };

      const result = service.simulate(employees, allocation, 100);

      const summedRevenue =
        result.department['A'].finalRevenue +
        result.department['B'].finalRevenue +
        result.department['C'].finalRevenue;
      const summedCost =
        result.department['A'].cost +
        result.department['B'].cost +
        result.department['C'].cost;

      expect(result.summary.totalRevenue).toBeCloseTo(summedRevenue, 5);
      expect(result.summary.totalCost).toBeCloseTo(summedCost, 5);
    });
  });
});
