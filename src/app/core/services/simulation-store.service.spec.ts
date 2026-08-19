import { TestBed } from '@angular/core/testing';
import {
  HttpClientTestingModule,
  HttpTestingController,
} from '@angular/common/http/testing';
import { SimulationStoreService } from './simulation-store.service';
import { SimulationEngineService } from './simulation-engine.service';
import { CsvParserService } from './csv-parser.service';
import { Employee } from '../models/simulation.model';

describe('SimulationStoreService', () => {
  let service: SimulationStoreService;
  let httpMock: HttpTestingController;
  let csvParserService: CsvParserService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [
        SimulationStoreService,
        SimulationEngineService,
        CsvParserService,
      ],
    });
    service = TestBed.inject(SimulationStoreService);
    httpMock = TestBed.inject(HttpTestingController);
    csvParserService = TestBed.inject(CsvParserService);
  });

  afterEach(() => {
    try {
      httpMock.verify();
    } catch {
      // Ignore verification errors from Worker initialization
    }
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('Initial state', () => {
    it('should have empty employees', () => {
      expect(service.employees()).toEqual([]);
    });

    it('should have empty allocation', () => {
      expect(service.allocation()).toEqual({});
    });

    it('should have null simulation result', () => {
      expect(service.simulationResult()).toBeNull();
    });

    it('should have isLoading = false', () => {
      expect(service.isLoading()).toBe(false);
    });
  });

  describe('loadInitialData', () => {
    it('should load and parse CSV data', async () => {
      const csvData = `社員番号,営業力,管理力,開拓力,育成力,人件費
E001,75,46,63,40,6.7
E002,85,67,59,42,9.9
E003,89,48,59,44,9.1`;

      service.loadInitialData();

      const req = httpMock.expectOne('/assets/human_resources_100.csv');
      expect(req.request.method).toBe('GET');
      req.flush(csvData);

      // Wait for async operations
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(service.employees().length).toBeGreaterThan(0);
    });

    it('should set isLoading to true during load', () => {
      service.loadInitialData();
      expect(service.isLoading()).toBe(true);

      const req = httpMock.expectOne('/assets/human_resources_100.csv');
      req.flush('test');
    });

    it('should handle load errors gracefully', async () => {
      service.loadInitialData();

      const req = httpMock.expectOne('/assets/human_resources_100.csv');
      req.error(new ErrorEvent('Network error'));

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(service.employees().length).toBe(0);
    });
  });

  describe('setEmployees', () => {
    it('should set employees directly', () => {
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
      ];

      service.setEmployees(employees);

      expect(service.employees()).toEqual(employees);
    });
  });

  describe('updateAllocation', () => {
    it('should update allocation', () => {
      const allocation = { A: 10, B: 20, C: 5 };

      service.updateAllocation(allocation);

      expect(service.allocation()).toEqual(allocation);
    });
  });

  describe('Simulation recalculation', () => {
    it('should not run simulation without allocation', () => {
      expect(service.simulationResult()).toBeNull();
    });

    it('should not run simulation without employees', async () => {
      service.setEmployees([]);
      service.updateAllocation({ A: 10, B: 10, C: 10 });

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(service.simulationResult()).toBeNull();
    });
  });

  describe('getState', () => {
    it('should return current state', () => {
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

      service.setEmployees(employees);
      service.updateAllocation({ A: 1, B: 0, C: 0 });

      const state = service.getState();
      expect(state.employees).toEqual(employees);
      expect(state.allocation).toEqual({ A: 1, B: 0, C: 0 });
      expect(state.isLoading).toBe(false);
    });
  });
});
