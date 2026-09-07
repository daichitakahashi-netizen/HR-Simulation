import { Component, Inject, OnInit, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatTableModule } from '@angular/material/table';
import { MatSortModule, Sort } from '@angular/material/sort';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatButtonModule } from '@angular/material/button';
import { Employee } from '../../../core/models/simulation.model';

export interface MemberListDialogData {
  departmentId: string;
  departmentLabel: string;
  allocatedEmployeeIds: string[];
  employees: Employee[];
}

// 経年タレントマネジメント（/hr-planning）専用の配置メンバー一覧ダイアログ。
// SimulationStoreService には依存しない（3重の隔離壁の維持）。
@Component({
  selector: 'app-member-list-dialog',
  imports: [
    CommonModule,
    MatDialogModule,
    MatTableModule,
    MatSortModule,
    MatInputModule,
    MatFormFieldModule,
    MatButtonModule,
  ],
  templateUrl: './member-list-dialog.component.html',
  styleUrl: './member-list-dialog.component.scss',
})
export class MemberListDialogComponent implements OnInit {
  readonly displayedColumns: string[] = [
    'id',
    'sales',
    'management',
    'development',
    'nurture',
    'personnelCost',
  ];

  readonly filterText = signal<string>('');
  readonly sortState = signal<Sort>({ active: '', direction: '' });

  constructor(
    public dialogRef: MatDialogRef<MemberListDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: MemberListDialogData
  ) {}

  readonly filteredAndSortedMembers = computed(() => {
    const departmentMembers = this.data.employees.filter((emp) =>
      this.data.allocatedEmployeeIds.includes(emp.id)
    );

    const filtered = departmentMembers.filter((emp) => {
      const searchText = this.filterText().toLowerCase();
      return (
        emp.id.toLowerCase().includes(searchText) ||
        emp.sales.toString().includes(searchText) ||
        emp.management.toString().includes(searchText) ||
        emp.development.toString().includes(searchText) ||
        emp.nurture.toString().includes(searchText)
      );
    });

    const sortState = this.sortState();
    if (!sortState.active) {
      return filtered;
    }

    return filtered.sort((a, b) => {
      let aValue: any = a[sortState.active as keyof Employee];
      let bValue: any = b[sortState.active as keyof Employee];

      if (typeof aValue === 'number' && typeof bValue === 'number') {
        return sortState.direction === 'asc' ? aValue - bValue : bValue - aValue;
      }

      aValue = String(aValue).toLowerCase();
      bValue = String(bValue).toLowerCase();
      return sortState.direction === 'asc'
        ? aValue.localeCompare(bValue)
        : bValue.localeCompare(aValue);
    });
  });

  ngOnInit(): void {}

  onFilterChange(text: string): void {
    this.filterText.set(text);
  }

  onSortChange(sort: Sort): void {
    this.sortState.set(sort);
  }
}
