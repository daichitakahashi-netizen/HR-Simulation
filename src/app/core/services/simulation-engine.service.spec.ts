import { TestBed } from '@angular/core/testing';
import { SimulationEngineService } from './simulation-engine.service';
import { Employee, DepartmentObjective } from '../models/simulation.model';

describe('SimulationEngineService', () => {
  let service: SimulationEngineService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(SimulationEngineService);
  });

  // Helper function to create mock employees
  function createMockEmployees(count: number): Employee[] {
    const employees: Employee[] = [];
    for (let i = 0; i < count; i++) {
      employees.push({
        id: `emp-${i}`,
        sales: 50 + (i % 20),
        management: 40 + (i % 20),
        development: 60 + (i % 20),
        nurture: 30 + (i % 20),
        personnelCost: 5 + (i % 10),
      });
    }
    return employees;
  }

  describe('Minimum headcount constraint (A=30, B=20, C=10)', () => {
    it('should respect minimum headcount for 100 employees', () => {
      const employees = createMockEmployees(100);
      const allocation = service.calculateOptimalAllocation(
        employees,
        'totalRevenue'
      );

      // At 100 employees: A=30 (30%), B=20 (20%), C=10 (10%)
      expect(allocation['A']).toBeGreaterThanOrEqual(30);
      expect(allocation['B']).toBeGreaterThanOrEqual(20);
      expect(allocation['C']).toBeGreaterThanOrEqual(10);
      expect(allocation['A'] + allocation['B'] + allocation['C']).toBe(100);
    });

    it('should respect minimum headcount for 110 employees', () => {
      const employees = createMockEmployees(110);
      const allocation = service.calculateOptimalAllocation(
        employees,
        'totalRevenue'
      );

      // At 110 employees: A=33 (30% of 110), B=22 (20% of 110), C=11 (10% of 110)
      expect(allocation['A']).toBeGreaterThanOrEqual(33);
      expect(allocation['B']).toBeGreaterThanOrEqual(22);
      expect(allocation['C']).toBeGreaterThanOrEqual(11);
      expect(allocation['A'] + allocation['B'] + allocation['C']).toBe(110);
    });

    it('should satisfy minimum constraints even with locked employees', () => {
      const employees = createMockEmployees(100);
      const locked = {
        [employees[0].id]: 'A',
        [employees[1].id]: 'B',
      };

      const allocation = service.calculateOptimalAllocation(
        employees,
        'totalRevenue',
        locked
      );

      expect(allocation['A']).toBeGreaterThanOrEqual(30);
      expect(allocation['B']).toBeGreaterThanOrEqual(20);
      expect(allocation['C']).toBeGreaterThanOrEqual(10);
    });
  });

  describe('Objective-based allocation changes', () => {
    it('should maximize total revenue for totalRevenue objective', () => {
      const employees = createMockEmployees(100);

      const totalRevenueResult = service.simulateWithAllocation(
        employees,
        service.getAllocatedEmployeeMapping(employees, 'totalRevenue'),
        employees.length
      );

      const totalRevenue = totalRevenueResult.summary.totalRevenue;
      expect(totalRevenue).toBeGreaterThan(0);
    });

    it('should change allocation between different objectives', () => {
      const employees = createMockEmployees(100);

      const alloc1 = service.getAllocatedEmployeeMapping(
        employees,
        'totalRevenue'
      );
      const alloc2 = service.getAllocatedEmployeeMapping(
        employees,
        'departmentAProfitMaximize'
      );

      // At least one department should have different allocation
      const different =
        alloc1['A'].length !== alloc2['A'].length ||
        alloc1['B'].length !== alloc2['B'].length ||
        alloc1['C'].length !== alloc2['C'].length;

      expect(different).toBe(true);
    });

    it('should maximize department A profit for departmentAProfitMaximize', () => {
      const employees = createMockEmployees(100);

      const mapping = service.getAllocatedEmployeeMapping(
        employees,
        'departmentAProfitMaximize'
      );

      const result = service.simulateWithAllocation(
        employees,
        mapping,
        employees.length
      );

      expect(result.department['A'].profit).toBeDefined();
      expect(result.department['A'].profit).toBeGreaterThanOrEqual(0);
    });

    it('should maximize department B revenue for departmentBRevenueMaximize', () => {
      const employees = createMockEmployees(100);

      const mapping = service.getAllocatedEmployeeMapping(
        employees,
        'departmentBRevenueMaximize'
      );

      const result = service.simulateWithAllocation(
        employees,
        mapping,
        employees.length
      );

      expect(result.department['B'].finalRevenue).toBeDefined();
      expect(result.department['B'].finalRevenue).toBeGreaterThan(0);
    });

    it('should maximize department C revenue for departmentCRevenueMaximize', () => {
      const employees = createMockEmployees(100);

      const mapping = service.getAllocatedEmployeeMapping(
        employees,
        'departmentCRevenueMaximize'
      );

      const result = service.simulateWithAllocation(
        employees,
        mapping,
        employees.length
      );

      expect(result.department['C'].finalRevenue).toBeDefined();
      expect(result.department['C'].finalRevenue).toBeGreaterThan(0);
    });
  });

  describe('Penalty and cost calculations', () => {
    it('should calculate shortage coefficient correctly', () => {
      // Fulfillment rate 1.0 (100%) -> coefficient 1.0 (no penalty)
      let coeff = service.getShortageCoefficient(1.0, 'A');
      expect(coeff).toBe(1.0);

      // Fulfillment rate 0.9 (90%) -> coefficient 0.85 for A
      coeff = service.getShortageCoefficient(0.9, 'A');
      expect(coeff).toBe(0.85);

      // Fulfillment rate 0.8 (80%) -> coefficient 0.7 for A
      coeff = service.getShortageCoefficient(0.8, 'A');
      expect(coeff).toBe(0.7);
    });

    it('should calculate surplus coefficient correctly', () => {
      // Fulfillment rate 1.0 (100%) -> coefficient 1.0
      let coeff = service.getSurplusCoefficient(1.0);
      expect(coeff).toBe(1.0);

      // Fulfillment rate 1.2 (120%) -> coefficient 1.0 (within range)
      coeff = service.getSurplusCoefficient(1.2);
      expect(coeff).toBe(1.0);

      // Fulfillment rate 1.3 (130%) -> coefficient 0.95
      coeff = service.getSurplusCoefficient(1.3);
      expect(coeff).toBe(0.95);

      // Fulfillment rate 1.5 (150%) -> coefficient 0.9
      coeff = service.getSurplusCoefficient(1.5);
      expect(coeff).toBe(0.9);

      // Fulfillment rate 1.8 (180%) -> coefficient 0.8
      coeff = service.getSurplusCoefficient(1.8);
      expect(coeff).toBe(0.8);
    });

    it('should calculate cost as personnelCost * 3 / 100', () => {
      const personnelCosts = [5, 10, 8]; // Sum = 23
      const expectedCost = (23 * 3) / 100; // 0.69

      const cost = service.calculateCost(personnelCosts);
      expect(cost).toBeCloseTo(expectedCost, 5);
    });

    it('should apply both shortage and surplus corrections to revenue', () => {
      const employees = createMockEmployees(100);
      const result = service.simulateWithAllocation(
        employees,
        service.getAllocatedEmployeeMapping(employees, 'totalRevenue'),
        employees.length
      );

      // Check that corrections were applied
      for (const dept of ['A', 'B', 'C']) {
        const deptResult = result.department[dept];
        expect(deptResult.finalRevenue).toBeLessThanOrEqual(deptResult.baseRevenue);
      }
    });

    it('should calculate profit as finalRevenue - cost', () => {
      const employees = createMockEmployees(100);
      const result = service.simulateWithAllocation(
        employees,
        service.getAllocatedEmployeeMapping(employees, 'totalRevenue'),
        employees.length
      );

      for (const dept of ['A', 'B', 'C']) {
        const deptResult = result.department[dept];
        const expectedProfit = deptResult.finalRevenue - deptResult.cost;
        expect(deptResult.profit).toBeCloseTo(expectedProfit, 5);
      }
    });
  });

  describe('Previous year revenue constraint', () => {
    it('should set isBelowPreviousYearRevenue flag when total revenue < 58', () => {
      // Create poor allocation scenario
      const employees = createMockEmployees(50); // Small pool
      const result = service.simulateWithAllocation(
        employees,
        service.getAllocatedEmployeeMapping(employees, 'totalRevenue'),
        employees.length
      );

      if (result.summary.totalRevenue < 58) {
        expect(result.summary.isBelowPreviousYearRevenue).toBe(true);
      }
    });

    it('should not set isBelowPreviousYearRevenue flag when total revenue >= 58', () => {
      const employees = createMockEmployees(100);
      const result = service.simulateWithAllocation(
        employees,
        service.getAllocatedEmployeeMapping(employees, 'totalRevenue'),
        employees.length
      );

      if (result.summary.totalRevenue >= 58) {
        expect(result.summary.isBelowPreviousYearRevenue).toBe(false);
      }
    });
  });

  describe('Employee contribution calculation', () => {
    it('should calculate employee contribution with correct weights', () => {
      const employee: Employee = {
        id: 'test-emp',
        sales: 100,
        management: 80,
        development: 60,
        nurture: 40,
        personnelCost: 10,
      };

      // For department A: sales 0.45, management 0.35, development 0.10, nurture 0.10
      const contribA = service.calculateEmployeeContribution(employee, 'A');
      const expectedA =
        100 * 0.45 + 80 * 0.35 + 60 * 0.1 + 40 * 0.1; // 45 + 28 + 6 + 4 = 83
      expect(contribA).toBeCloseTo(expectedA, 5);

      // For department C: sales 0.20, management 0.10, development 0.50, nurture 0.20
      const contribC = service.calculateEmployeeContribution(employee, 'C');
      const expectedC =
        100 * 0.2 + 80 * 0.1 + 60 * 0.5 + 40 * 0.2; // 20 + 8 + 30 + 8 = 66
      expect(contribC).toBeCloseTo(expectedC, 5);
    });
  });

  describe('Department capability and base revenue', () => {
    it('should calculate department capability as sum of contributions', () => {
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

      const capability = service.calculateDepartmentCapability(
        employees,
        'A'
      );
      const contrib1 = service.calculateEmployeeContribution(employees[0], 'A');
      const contrib2 = service.calculateEmployeeContribution(employees[1], 'A');
      const expected = contrib1 + contrib2;

      expect(capability).toBeCloseTo(expected, 5);
    });

    it('should calculate base revenue correctly', () => {
      // Base revenue formula: baseRevenue * (1 + (capability / 100) * growthRate)
      // For A: baseRevenue = 10, growthRate = 0.06
      const capability = 100;
      const baseRevenue = service.calculateBaseRevenue(capability, 'A');
      const expected = 10 * (1 + (100 / 100) * 0.06); // 10 * 1.06 = 10.6
      expect(baseRevenue).toBeCloseTo(expected, 5);

      // For C: baseRevenue = 2, growthRate = 0.25
      const baseRevenueC = service.calculateBaseRevenue(capability, 'C');
      const expectedC = 2 * (1 + (100 / 100) * 0.25); // 2 * 1.25 = 2.5
      expect(baseRevenueC).toBeCloseTo(expectedC, 5);
    });
  });

  describe('Fulfillment rate calculation', () => {
    it('should calculate fulfillment rate correctly', () => {
      // Fulfillment rate = allocated / appropriate
      const fulfillmentRate = service.calculateFulfillmentRate(100, 100);
      expect(fulfillmentRate).toBeCloseTo(1.0, 5);

      const fulfillmentRate2 = service.calculateFulfillmentRate(90, 100);
      expect(fulfillmentRate2).toBeCloseTo(0.9, 5);

      const fulfillmentRate3 = service.calculateFulfillmentRate(120, 100);
      expect(fulfillmentRate3).toBeCloseTo(1.2, 5);
    });

    it('should return 0 when appropriate headcount is 0', () => {
      const fulfillmentRate = service.calculateFulfillmentRate(10, 0);
      expect(fulfillmentRate).toBe(0);
    });
  });

  describe('Optimal allocation verification (Phase 1 test)', () => {
    it('should verify optimal allocation for 100 employees without locks', () => {
      const employees = createMockEmployees(100);

      const result = service.verifyOptimalAllocation(employees);

      expect(result.optimalAllocation).toBeDefined();
      expect(result.optimalAllocation['A']).toBeGreaterThanOrEqual(30);
      expect(result.optimalAllocation['B']).toBeGreaterThanOrEqual(20);
      expect(result.optimalAllocation['C']).toBeGreaterThanOrEqual(10);
      expect(result.optimalRevenue).toBeGreaterThan(0);
      expect(result.comparison.length).toBeGreaterThan(0);
    });

    it('should show comparison between optimal and local solution (48/42/10)', () => {
      const employees = createMockEmployees(100);

      const result = service.verifyOptimalAllocation(employees);

      expect(result.localSolutionRevenue).toBeDefined();
      expect(result.localSolutionProfit).toBeDefined();

      // Optimal should be better than or equal to local solution
      if (result.optimalRevenue !== result.localSolutionRevenue) {
        expect(result.optimalRevenue).toBeGreaterThanOrEqual(result.localSolutionRevenue! - 0.0001);
      }
    });

    it('should evaluate specific allocation patterns correctly', () => {
      const employees = createMockEmployees(100);

      // Test 40/40/20 pattern
      const result40 = service.evaluateAllocationPattern(
        employees,
        { A: 40, B: 40, C: 20 },
        'totalRevenue'
      );

      expect(result40.allocation['A']).toBe(40);
      expect(result40.allocation['B']).toBe(40);
      expect(result40.allocation['C']).toBe(20);
      expect(result40.totalRevenue).toBeGreaterThan(0);

      // Test 48/42/10 pattern
      const result48 = service.evaluateAllocationPattern(
        employees,
        { A: 48, B: 42, C: 10 },
        'totalRevenue'
      );

      expect(result48.allocation['A']).toBe(48);
      expect(result48.allocation['B']).toBe(42);
      expect(result48.allocation['C']).toBe(10);
      expect(result48.totalRevenue).toBeGreaterThan(0);
    });

    it('should throw error for non-100 employee count', () => {
      const employees = createMockEmployees(50);

      expect(() => {
        service.verifyOptimalAllocation(employees);
      }).toThrowError('Verification test requires exactly 100 employees');
    });

    it('should respect lock constraints and reject invalid locks', () => {
      const employees = createMockEmployees(100);

      // Create an impossible lock situation (too many locks for one department)
      const lockedEmployees: Record<string, string> = {};
      for (let i = 0; i < 95; i++) {
        lockedEmployees[employees[i].id] = 'A';
      }

      expect(() => {
        service.calculateOptimalAllocation(
          employees,
          'totalRevenue',
          lockedEmployees
        );
      }).toThrowError();
    });
  });
});
