import { Routes } from '@angular/router';
import { DashboardComponent } from './features/dashboard/dashboard.component';
import { DepartmentAnalysisComponent } from './features/department-analysis/department-analysis.component';
import { DataManagementComponent } from './features/data-management/data-management.component';
import { ScenarioComparisonComponent } from './features/scenario-comparison/scenario-comparison.component';
import { ReportComponent } from './features/report/report.component';
import { HrPlanningComponent } from './features/hr-planning/hr-planning.component';
import { HrDashboardComponent } from './features/hr-planning/dashboard/hr-dashboard.component';
import { HrKarteComponent } from './features/hr-planning/karte/hr-karte.component';
import { HrAnalyticsComponent } from './features/hr-planning/analytics/hr-analytics.component';
import { HrScenarioListComponent } from './features/hr-planning/scenarios/hr-scenario-list.component';

// ルーティング分離（3重の隔離壁の1層目）:
// /simulation  … 課題1〜4検証用（CSV参照, SimulationStoreServiceと連携）
// /hr-planning … 経年タレントマネジメント実務用（Firestore参照, HrPlanningStoreServiceと連携）
export const routes: Routes = [
  { path: '', redirectTo: '/simulation/dashboard', pathMatch: 'full' },
  {
    path: 'simulation',
    children: [
      { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
      { path: 'dashboard', component: DashboardComponent },
      { path: 'department-analysis', component: DepartmentAnalysisComponent },
      { path: 'data-management', component: DataManagementComponent },
      { path: 'scenario-comparison', component: ScenarioComparisonComponent },
      { path: 'report', component: ReportComponent },
    ],
  },
  {
    path: 'hr-planning',
    component: HrPlanningComponent,
    children: [
      { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
      { path: 'dashboard', component: HrDashboardComponent },
      { path: 'karte', component: HrKarteComponent },
      { path: 'analytics', component: HrAnalyticsComponent },
      { path: 'scenarios', component: HrScenarioListComponent },
    ],
  },
  // 旧パスからの後方互換リダイレクト
  { path: 'dashboard', redirectTo: '/simulation/dashboard' },
  { path: 'department-analysis', redirectTo: '/simulation/department-analysis' },
  { path: 'data-management', redirectTo: '/simulation/data-management' },
  { path: 'scenario-comparison', redirectTo: '/simulation/scenario-comparison' },
  { path: 'report', redirectTo: '/simulation/report' },
];
