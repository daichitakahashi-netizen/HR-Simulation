import { Component, OnInit, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTableModule } from '@angular/material/table';
import { MatToolbarModule } from '@angular/material/toolbar';
import { SimulationStoreService } from '../../core/services/simulation-store.service';
import { AllocationResult, DepartmentConfig } from '../../core/models/simulation.model';

@Component({
  selector: 'app-report',
  imports: [
    CommonModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatTableModule,
    MatToolbarModule,
  ],
  templateUrl: './report.component.html',
  styleUrl: './report.component.scss',
})
export class ReportComponent implements OnInit {
  simulationResult = signal<AllocationResult | null>(null);
  employees = signal<any[]>([]);
  allocation = signal<Record<string, number>>({});
  warnings = signal<string[]>([]);
  revenueLessThan58B = computed(() => {
    const result = this.simulationResult();
    return result ? result.summary.totalRevenue < 5.8 : false;
  });
  now = new Date();

  private departmentConfigs: Record<string, DepartmentConfig> = {
    A: {
      baseRevenue: 10,
      growthRate: 0.06,
      standardHeadcount: 40,
      minHeadcount: 30,
    },
    B: {
      baseRevenue: 7,
      growthRate: 0.12,
      standardHeadcount: 35,
      minHeadcount: 20,
    },
    C: {
      baseRevenue: 2,
      growthRate: 0.25,
      standardHeadcount: 25,
      minHeadcount: 10,
    },
  };

  constructor(private simulationStore: SimulationStoreService) {}

  ngOnInit(): void {
    this.simulationResult.set(this.simulationStore.simulationResult());
    this.employees.set(this.simulationStore.employees());
    this.allocation.set(this.simulationStore.allocation());
    this.checkConstraints();
  }

  private checkConstraints(): void {
    const warnings: string[] = [];
    const result = this.simulationResult();
    const alloc = this.allocation();

    if (!result) return;

    // Check minimum headcount constraints
    Object.entries(this.departmentConfigs).forEach(([dept, config]) => {
      const allocatedCount = alloc[dept] || 0;
      if (allocatedCount < config.minHeadcount) {
        warnings.push(
          `⚠️ ${dept}事業部: 配置人数${allocatedCount}名は最低配置人数${config.minHeadcount}名を下回っています`
        );
      }
    });

    // Check fulfillment rate and penalize large deviations
    Object.entries(result.department).forEach(([dept, deptResult]) => {
      const fulfillmentRate = deptResult.fulfillmentRate;
      if (fulfillmentRate < 0.7) {
        warnings.push(
          `⚠️ ${dept}事業部: 充足率${(fulfillmentRate * 100).toFixed(1)}%が低く、ペナルティが大きく発生しています`
        );
      }
    });

    this.warnings.set(warnings);
  }

  print(): void {
    window.print();
  }

  downloadCsv(): void {
    const result = this.simulationResult();
    const emps = this.employees();
    const alloc = this.allocation();

    if (!result || emps.length === 0) return;

    const csvData = this.generateCsv(emps, alloc, result);
    this.triggerDownload(csvData, 'allocation_list.csv');
  }

  private generateCsv(
    employees: any[],
    allocation: Record<string, number>,
    result: AllocationResult
  ): string {
    const headers = [
      '社員ID',
      '配置事業部',
      '営業力',
      '管理力',
      '開拓力',
      '育成力',
      '人件費',
    ];

    const rows: string[] = [headers.join(',')];

    // Build allocation map: employee -> department
    const employeeToDepartment = this.buildEmployeeAllocationMap(employees, allocation, result);

    employees.forEach((emp) => {
      const dept = employeeToDepartment[emp.id] || '未配置';
      const row = [
        emp.id,
        dept,
        emp.sales,
        emp.management,
        emp.development,
        emp.nurture,
        emp.personnelCost,
      ];
      rows.push(row.map((v) => this.escapeCsvValue(v.toString())).join(','));
    });

    return rows.join('\n');
  }

  private buildEmployeeAllocationMap(
    employees: any[],
    allocation: Record<string, number>,
    result: AllocationResult
  ): Record<string, string> {
    const map: Record<string, string> = {};
    const sortedEmps = [...employees].sort(
      (a, b) =>
        this.calculateContribution(b) - this.calculateContribution(a)
    );

    Object.entries(allocation).forEach(([dept, count]) => {
      for (let i = 0; i < count && sortedEmps.length > 0; i++) {
        const emp = sortedEmps.shift();
        if (emp) {
          map[emp.id] = dept;
        }
      }
    });

    return map;
  }

  private calculateContribution(emp: any): number {
    const weights: Record<string, any> = {
      A: { sales: 0.45, management: 0.35, development: 0.1, nurture: 0.1 },
      B: { sales: 0.35, management: 0.2, development: 0.3, nurture: 0.15 },
      C: { sales: 0.2, management: 0.1, development: 0.5, nurture: 0.2 },
    };
    const avgWeights = {
      sales: 0.33,
      management: 0.22,
      development: 0.3,
      nurture: 0.15,
    };
    return (
      emp.sales * avgWeights.sales +
      emp.management * avgWeights.management +
      emp.development * avgWeights.development +
      emp.nurture * avgWeights.nurture
    );
  }

  private escapeCsvValue(value: string): string {
    if (value.includes(',') || value.includes('"') || value.includes('\n')) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  }

  private triggerDownload(csvData: string, filename: string): void {
    const blob = new Blob([csvData], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);

    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
}
