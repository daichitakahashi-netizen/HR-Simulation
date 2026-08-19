import { Component, Inject, OnInit, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatTableModule } from '@angular/material/table';
import { MatSortModule, Sort } from '@angular/material/sort';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Employee } from '../../../core/models/simulation.model';
import { SimulationStoreService } from '../../../core/services/simulation-store.service';

export interface MemberDialogData {
  departmentId: string;
  departmentLabel: string;
  allocatedEmployeeIds: string[];
  employees: Employee[];
}

@Component({
  selector: 'app-member-dialog',
  imports: [
    CommonModule,
    MatDialogModule,
    MatTableModule,
    MatSortModule,
    MatInputModule,
    MatFormFieldModule,
    MatSlideToggleModule,
    MatButtonModule,
    MatProgressSpinnerModule,
  ],
  templateUrl: './member-dialog.component.html',
  styleUrl: './member-dialog.component.scss',
})
export class MemberDialogComponent implements OnInit {
  readonly displayedColumns: string[] = [
    'id',
    'sales',
    'management',
    'development',
    'nurture',
    'personnelCost',
    'lock',
  ];

  readonly filterText = signal<string>('');
  readonly sortState = signal<Sort>({ active: '', direction: '' });
  readonly lockedMembers = signal<Set<string>>(new Set());

  constructor(
    public dialogRef: MatDialogRef<MemberDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: MemberDialogData,
    private store: SimulationStoreService
  ) {
    this.lockedMembers.set(
      new Set(
        Object.entries(this.store.lockedEmployees())
          .filter(([_, dept]) => dept === this.data.departmentId)
          .map(([empId]) => empId)
      )
    );
  }

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

  readonly isLoading = computed(() => this.store.isLoading());

  ngOnInit(): void {}

  onFilterChange(text: string): void {
    this.filterText.set(text);
  }

  onSortChange(sort: Sort): void {
    this.sortState.set(sort);
  }

  toggleLock(employeeId: string): void {
    const locked = new Set(this.lockedMembers());
    if (locked.has(employeeId)) {
      locked.delete(employeeId);
    } else {
      locked.add(employeeId);
    }
    this.lockedMembers.set(locked);
  }

  isLocked(employeeId: string): boolean {
    return this.lockedMembers().has(employeeId);
  }

  onRecalculate(): void {
    const previousLocked = { ...this.store.lockedEmployees() };
    const newLocked = { ...previousLocked };

    // Remove all locks for this department
    Object.keys(newLocked).forEach((empId) => {
      if (newLocked[empId] === this.data.departmentId) {
        delete newLocked[empId];
      }
    });

    // Add new locks
    this.lockedMembers().forEach((empId) => {
      newLocked[empId] = this.data.departmentId;
    });

    // Update store with new locks and trigger recalculation
    this.store.lockedEmployees.set(newLocked);
    const employees = this.store.employees$.value;
    this.store.employees$.next([...employees]);

    // Close dialog after recalculation
    this.dialogRef.close();
  }
}
