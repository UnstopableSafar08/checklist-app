/* Checklist Ops Console — config (no modules for file:// compat). */
(function (global) {
  "use strict";
  global.ChecklistConfig = Object.freeze({
    STORAGE_KEY: "checklist-status-v1",
    THEME_KEY: "checklist-theme",
    CUSTOM_KEY: "checklist-custom-v1",
    ACTIVITY_KEY: "checklist-activity-v1",
    DENSITY_KEY: "checklist-density",
    SORT_KEY: "checklist-sort",
    PAGE_SIZE_KEY: "checklist-page-size",
    ACT_PAGE_SIZE_KEY: "checklist-activity-page-size",
    SIDEBAR_KEY: "checklist-sidebar-v2",
    LISTS_KEY: "checklists-v1",
    LIST_STATE_KEY: "checklist-state-v1",
    ACTIVE_LIST_KEY: "active-checklist-id",
    COLLAPSED_KEY: "checklist-collapsed-v1",
    SIDE_PAGE_SIZE: 6,
    DATA_URLS: ["assets/data/checklist-items.txt", "checklist-items.txt"],
    EXPORT_PREFIX: "checklist",
    APP_VERSION: "2.2.0",
    ENV_LABEL: "PROD",
  });
})(window);
