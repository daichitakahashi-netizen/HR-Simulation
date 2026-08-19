// Employee abilities interface
export interface EmployeeAbilities {
  sales: number; // 営業力 (0-100)
  management: number; // 管理力 (0-100)
  development: number; // 開拓力 (0-100)
  nurture: number; // 育成力 (0-100)
}

// Employee full data model
export interface EmployeeData extends EmployeeAbilities {
  id: string;
  name?: string; // 社員名（オプション）
  personnelCost: number; // 人件費 (1-20)
}

// Employee contribution score for a department
export interface EmployeeContribution {
  employeeId: string;
  department: string;
  contributionScore: number; // 社員貢献度
  contribution: EmployeeAbilities; // 各能力の重み付け後の値
}
