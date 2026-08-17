import { Routes } from '@angular/router';
import { DashboardComponent } from './features/dashboard/dashboard.component';
import { DepartmentAnalysisComponent } from './features/department-analysis/department-analysis.component';
import { DataManagementComponent } from './features/data-management/data-management.component';

export const routes: Routes = [
  { path: '', redirectTo: '/dashboard', pathMatch: 'full' },
  { path: 'dashboard', component: DashboardComponent },
  { path: 'department-analysis', component: DepartmentAnalysisComponent },
  { path: 'data-management', component: DataManagementComponent },
];
