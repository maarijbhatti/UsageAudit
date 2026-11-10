import { Module } from "@nestjs/common";
import { DatabaseModule } from "./common/database";
import { Storage } from "./common/storage";
import { ImportsService } from "./modules/imports/imports.service";
import { ImportsController } from "./modules/imports/imports.controller";
import {
  ConfigurationService,
  ConfigurationController,
} from "./modules/pricing/configuration";
import { SnapshotsService } from "./modules/connections/snapshots.service";
import { ReconciliationService } from "./modules/reconciliation/reconciliation.service";
import { ReconciliationController } from "./modules/reconciliation/reconciliation.controller";
import { FindingsController } from "./modules/findings/findings";
import { DashboardController } from "./modules/dashboard/dashboard";
import { ReportsController, ReportsService } from "./modules/reports/reports";
import { OperationsController } from "./modules/operations/operations";
import {
  ConnectionsController,
  ConnectionsService,
} from "./modules/connections/connections";
const services = [
  Storage,
  ImportsService,
  ConfigurationService,
  SnapshotsService,
  ReconciliationService,
  ReportsService,
  ConnectionsService,
];
@Module({
  imports: [DatabaseModule],
  providers: services,
  exports: services,
  controllers: [
    ImportsController,
    ConfigurationController,
    ReconciliationController,
    FindingsController,
    DashboardController,
    ReportsController,
    OperationsController,
    ConnectionsController,
  ],
})
export class DomainModule {}
