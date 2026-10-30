import type { ComponentType } from 'react';
import { CrmScreen } from './src/components/ui';
import { CalendarPage } from './src/pages/CalendarPage';
import { CustomersPage } from './src/pages/CustomersPage';
import { ReportsPage } from './src/pages/ReportsPage';
import { TasksPage } from './src/pages/TasksPage';
import { WorkspacePage } from './src/pages/WorkspacePage';
import './src/styles/crm.css';

// CRM — frontend entry of the package (module.json "frontendEntry", Host protocol TALO-MODULE-HOST-1): `screens` maps
// each screenKey of module.json to its component ({ tab, onSessionLost }). The 5 screens are opened from the Foundation
// menu (B09, IAM filtered); the server decides every access once the CRM backend is reachable.

interface ModuleScreenProps {
  readonly tab: number;
  readonly onSessionLost: () => void;
}

function screen(Page: ComponentType): ComponentType<ModuleScreenProps> {
  return function CrmModuleScreen({ onSessionLost }: ModuleScreenProps) {
    return <CrmScreen onSessionLost={onSessionLost}><Page /></CrmScreen>;
  };
}

export const screens = {
  'crm.workspace': screen(WorkspacePage),
  'crm.customers': screen(CustomersPage),
  'crm.calendar': screen(CalendarPage),
  'crm.tasks': screen(TasksPage),
  'crm.reports': screen(ReportsPage),
};
