// src/components/logistics/types.ts
// Shared shapes for the /v2/logistics dashboard + BOL modals — kept in one place so the
// dashboard, row, actions, and modals never drift on field names.

export interface ShipmentListItem {
  id: string;
  job_id: string | null;
  customer: string | null;
  invoice_number: string | null;
  method: string | null;
  carrier: string | null;
  trailer_number: string | null;
  load_count: number | null;
  total_bdft: number | string | null;
  bol_number: string | null;
  bol_count: number;
  status: string;
  ship_date: string | null;
}

export interface JobLineItem {
  part_number: string | null;
  description: string | null;
  quantity: number | string | null;
}

export interface JobForBol {
  id: string;
  customer: string | null;
  invoice_number: string | null;
  po_number: string | null;
  ship_date: string | null;
  load_count: number | null;
  carrier: string | null;
  delivery_time: string | null;
  scrap_pickup: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  location: string | null;
  ship_to_company: string | null;
  ship_to_attention: string | null;
  ship_to_street: string | null;
  ship_to_street2: string | null;
  ship_to_city: string | null;
  ship_to_state: string | null;
  ship_to_zip: string | null;
  line_items: JobLineItem[];
}

export interface LoadingAssignmentForJob {
  id: string;
  job_id: string;
  load_number: number | null;
  trailer_number: string | null;
  load_ship_date: string | null;
}
