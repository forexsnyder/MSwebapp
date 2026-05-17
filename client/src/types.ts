/** Inventory part row (internal `id` is the DB primary key). */
export type Part = {
  id: number;
  part_id: string;
  part_revision_id: string;
  on_hand_quantity: number;
  inventory_abbreviation_code: string;
  default_inventory_location_id: string;
  manufacturing_order_id: string;
  component_order_id: string;
  component_part_id: string;
  component_part_revision_id: string;
  to_issue_quantity: number;
  mo_status_code_description: string;
};

export type Order = {
  id: number;
  created_at: string;
  requester_name: string;
  manufacturing_order_id: string;
  component_part_id: string;
  component_part_revision_id: string;
  to_issue_quantity: number;
  mo_status_code_description: string;
};

export type PickTicketLine = {
  id: number;
  inventory_part_id: number;
  requested_quantity: number;
  part_id: string;
  part_revision_id: string;
  on_hand_quantity: number;
  inventory_abbreviation_code: string;
  default_inventory_location_id: string;
  manufacturing_order_id: string;
  component_order_id: string;
  component_part_id: string;
  component_part_revision_id: string;
  to_issue_quantity: number;
  mo_status_code_description: string;
};

export type PickTicket = {
  id: number;
  created_at: string;
  requester_name: string;
  status: "open" | "closed";
  closed_at: string | null;
  closed_by: string | null;
  lines: PickTicketLine[];
};

export type PickTicketSummary = {
  id: number;
  created_at: string;
  requester_name: string;
  status: "open" | "closed";
  line_count: number;
};

export type AuditLogEntry = {
  id: number;
  created_at: string;
  actor: string;
  action: string;
  entity: string;
  entity_id: string | null;
  payload_json: string;
  payload_hash: string;
  prev_entry_hash: string | null;
  entry_hash: string;
};
