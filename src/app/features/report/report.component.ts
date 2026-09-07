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
  simulationResult = computed(() => this.simulationStore.simulationResult());
  employees = computed(() => this.simulationStore.employees());
  allocation = computed(() => this.simulationStore.allocation());
  warnings = computed(() => {
    const warnings: string[] = [];
    const result = this.simulationResult();
    const alloc = this.allocation();

    if (!result) return warnings;

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

    return warnings;
  });
  revenueLessThan58B = computed(() => {
    const result = this.simulationResult();
    return result ? result.summary.totalRevenue < 5.8 : false;
  });
  readonly reasonText = computed(() => this.simulationStore.reasonText());
  readonly userNotes = computed(() => this.simulationStore.userNotes());
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
    // No need to manually set signals; computed properties now track store values directly
  }

  print(): void {
    window.print();
  }

  downloadCsv(): void {
    const result = this.simulationResult();
    const emps = this.employees();
    const alloc = this.allocation();

    if (!result || emps.length === 0) return;

    const csv = this.generateCsv(emps, alloc, result);
    const dateStr = this.now.toISOString().split('T')[0].replace(/-/g, '');
    const filename = `配置リスト_${dateStr}.csv`;
    this.triggerDownload(csv, filename);
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
      '人件費(100万円)',
      '事業部貢献度',
    ];

    const rows: string[] = [this.escapeCSVHeader(headers.join(','))];

    const employeeToDepartment = this.buildEmployeeAllocationMap(employees, allocation, result);

    employees.forEach((emp) => {
      const dept = employeeToDepartment[emp.id] || '未配置';
      const contribution = dept !== '未配置' ? this.calculateContributionByDepartment(emp, dept) : 0;
      const row = [
        emp.id,
        dept,
        emp.sales,
        emp.management,
        emp.development,
        emp.nurture,
        emp.personnelCost,
        contribution.toFixed(2),
      ];
      rows.push(this.escapeCSVRow(row));
    });

    const bom = '﻿';
    return bom + rows.join('\n');
  }

  private escapeCSVRow(row: any[]): string {
    return row.map(cell => this.escapeCSVCell(cell)).join(',');
  }

  private escapeCSVHeader(header: string): string {
    return header;
  }

  private escapeCSVCell(cell: any): string {
    const value = String(cell);
    if (value.includes(',') || value.includes('"') || value.includes('\n')) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  }

  private triggerDownload(csv: string, filename: string): void {
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
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

  private calculateContributionByDepartment(emp: any, department: string): number {
    const weights: Record<string, any> = {
      A: { sales: 0.45, management: 0.35, development: 0.1, nurture: 0.1 },
      B: { sales: 0.35, management: 0.2, development: 0.3, nurture: 0.15 },
      C: { sales: 0.2, management: 0.1, development: 0.5, nurture: 0.2 },
    };
    const w = weights[department] || weights['A'];
    return (
      emp.sales * w.sales +
      emp.management * w.management +
      emp.development * w.development +
      emp.nurture * w.nurture
    );
  }

}
