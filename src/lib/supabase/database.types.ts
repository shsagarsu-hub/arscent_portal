// Hand-written to match schema.sql. Regenerate with the Supabase CLI
// (`supabase gen types typescript`) once the project has real migrations.
//
// Two gotchas that will silently collapse every query result to `never`
// under strictNullChecks if reintroduced:
//   1. Row/Insert/Update must be `type` aliases, not `interface`s — postgrest-js's
//      recursive conditional types (embedded-relationship inference) don't
//      resolve correctly against interface-declared object types.
//   2. Insert/Update must be spelled out as literal object types, not derived
//      with `Partial<Row>` (or any mapped type) — same failure mode.

export type UserRole = "hospital" | "account_manager" | "admin";
export type BillingStatus = "pending" | "requested" | "billed";
export type OrderType =
  | "saleable"
  | "capital_sales"
  | "direct_ship"
  | "export"
  | "sales_return"
  | "long_term_consignment"
  | "long_term_consignment_consumption"
  | "short_term_consignment"
  | "short_term_consignment_consumption";
export type OrderStatus =
  | "submitted"
  | "confirmed"
  | "shipped"
  | "cancelled"
  | "closed"
  | "ordered"
  | "received_to_arscent"
  | "sent_to_hospital"
  | "delivered";
export type MovementCategory =
  | "purchase_in"
  | "dc_out"
  | "sale_out"
  | "material_out"
  | "dc_return_in"
  | "material_in";

export type Account = {
  id: string;
  code: string;
  label: string;
  commitment_start: string | null;
  commitment_period_months: number | null;
  iol_payment_days: number | null;
  license_payment_term: string | null;
  interest_rate: string | null;
  review_cadence: string | null;
  key_dates: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type AccountLocation = {
  id: string;
  account_id: string;
  name: string;
  created_at: string;
};

export type Sku = {
  id: string;
  account_id: string;
  name: string;
  price_ex_gst: number | null;
  // What Zeiss charges Arscent for this product -- the cost side of gross
  // margin (price_ex_gst is the revenue side, what the hospital pays
  // Arscent). Also used to prefill the Purchase tab's unit price, since
  // that's the literal price a real PO to Zeiss would be raised at.
  transfer_price: number | null;
  // How many billable procedures/units one invoice-line qty actually
  // represents. Almost always 1 (qty=1 means one lens), but a "Pack of 10" /
  // "(10 Procedure)" licence product (SMILE Pro, FLAP) sells in bundles --
  // qty=1 on such a line is one bundle of 10, not one procedure -- and both
  // price_ex_gst and transfer_price are quoted per single procedure, so
  // revenue/cost/achievement all need qty * units_per_pack, not raw qty.
  units_per_pack: number;
  commitment_per_month: number | null;
  created_at: string;
  updated_at: string;
};

export type Profile = {
  id: string;
  full_name: string | null;
  role: UserRole;
  account_id: string | null;
  location_id: string | null;
  created_at: string;
};

export type UsageLog = {
  id: string;
  account_id: string;
  location_id: string;
  sku_id: string;
  entry_date: string;
  qty: number;
  note: string | null;
  batch_number: string;
  item_master_id: string | null;
  source_order_line_id: string | null;
  consumption_order_line_id: string | null;
  logged_by: string | null;
  created_at: string;
};

export type BillingRequest = {
  id: string;
  usage_log_id: string | null;
  order_line_id: string | null;
  account_id: string;
  location_id: string;
  sku_id: string;
  entry_date: string;
  qty: number;
  unit_price: number | null;
  amount: number | null;
  status: BillingStatus;
  requested_at: string | null;
  billed_at: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  invoice_attachment_url: string | null;
  batch_number: string | null;
  item_master_id: string | null;
  created_at: string;
};

export type Order = {
  id: string;
  order_type: OrderType;
  status: OrderStatus;
  account_id: string;
  location_id: string;
  po_number: string | null;
  requested_date: string | null;
  delivery_instruction: string | null;
  comment: string | null;
  tax_code: string | null;
  order_line_text: string | null;
  currency_code: string;
  sales_rep: string | null;
  partial_shipment: boolean;
  po_attachment_url: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  sales_invoice_url: string | null;
  tracking_info: string | null;
  dc_number: string | null;
  dc_date: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type OrderLine = {
  id: string;
  order_id: string;
  sku_id: string;
  qty: number;
  uom: string;
  net_price: number | null;
  notes: string | null;
  source_order_line_id: string | null;
  created_at: string;
};

export type ItemMaster = {
  id: string;
  gtin: string;
  name: string;
  account_id: string | null;
  price_ex_gst: number | null;
  created_at: string;
};

export type StockMovement = {
  id: string;
  item_id: string;
  category: MovementCategory;
  qty: number;
  hospital_account_id: string | null;
  batch_number: string | null;
  expiry_date: string | null;
  tally_invoice_line_id: string | null;
  billing_request_id: string | null;
  order_line_id: string | null;
  scanned_by: string | null;
  notes: string | null;
  created_at: string;
};

export type StockBalance = {
  item_id: string;
  gtin: string;
  name: string;
  purchase_in: number;
  dc_out: number;
  sale_out: number;
  material_out: number;
  dc_return_in: number;
  material_in: number;
  balance: number;
};

export type StockBalanceByBatch = StockBalance & {
  batch_number: string | null;
  expiry_date: string | null;
};

export type PurchaseOrder = {
  id: string;
  po_number: string;
  created_by: string | null;
  created_at: string;
  gst_percent: number | null;
  delivery: string | null;
  payment: string | null;
  warranty: string | null;
  notes: string | null;
  to_emails: string | null;
  cc_emails: string | null;
};

export type PurchaseOrderLine = {
  id: string;
  purchase_order_id: string;
  item_id: string | null;
  item_name: string;
  qty: number;
  unit_price: number | null;
  hsn: string | null;
};

export type TallyInvoiceLine = {
  id: string;
  invoice_no: string;
  invoice_date: string;
  account_id: string;
  item_id: string | null;
  sku_id: string | null;
  description_raw: string;
  qty: number;
  rate: number | null;
  batch_number: string | null;
  expiry_date: string | null;
  imported_by: string | null;
  document_type: "invoice" | "credit_note" | "debit_note";
  related_invoice_no: string | null;
  created_at: string;
};

export type ReceivablePayment = {
  id: string;
  invoice_no: string;
  amount_received: number;
  utr: string;
  payment_date: string;
  recorded_by: string | null;
  created_at: string;
};

export type CommitmentAdjustment = {
  id: string;
  account_id: string;
  sku_id: string;
  period_month: string;
  actual_qty: number;
  commitment_qty: number;
  adjustment_type: "credit" | "debit";
  adjustment_amount: number;
  status: "pending" | "raised";
  note_no: string | null;
  raised_date: string | null;
  created_at: string;
};

export type AssetCategory = "capital_equipment" | "benefit_equipment" | "cmc_support" | "other";
export type AssetStatus = "pending" | "po_raised" | "delivered" | "invoiced" | "payment_received" | "closed";

export type Asset = {
  id: string;
  account_id: string;
  location_id: string | null;
  asset_name: string;
  category: AssetCategory;
  agreement_reference: string | null;
  serial_number: string | null;
  equipment_value: number | null;
  invoice_value: number | null;
  po_raised_to_zeiss: boolean;
  po_to_zeiss_number: string | null;
  po_to_zeiss_date: string | null;
  payment_received_from_hospital: boolean;
  payment_received_amount: number | null;
  payment_received_date: string | null;
  po_received_from_hospital: boolean;
  po_from_hospital_number: string | null;
  po_from_hospital_date: string | null;
  po_from_hospital_price: number | null;
  status: AssetStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type ConsignmentBalance = {
  account_id: string;
  account_label: string;
  item_id: string;
  gtin: string;
  item_name: string;
  sent: number;
  returned: number;
  consumed: number;
  balance: number;
};

export type ConsignmentBalanceByBatch = ConsignmentBalance & {
  batch_number: string;
};

export interface Database {
  public: {
    Tables: {
      accounts: {
        Row: Account;
        Insert: {
          id?: string;
          code: string;
          label: string;
          commitment_start?: string | null;
          commitment_period_months?: number | null;
          iol_payment_days?: number | null;
          license_payment_term?: string | null;
          interest_rate?: string | null;
          review_cadence?: string | null;
          key_dates?: string | null;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          code?: string;
          label?: string;
          commitment_start?: string | null;
          commitment_period_months?: number | null;
          iol_payment_days?: number | null;
          license_payment_term?: string | null;
          interest_rate?: string | null;
          review_cadence?: string | null;
          key_dates?: string | null;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      account_locations: {
        Row: AccountLocation;
        Insert: { id?: string; account_id: string; name: string; created_at?: string };
        Update: { id?: string; account_id?: string; name?: string; created_at?: string };
        Relationships: [
          {
            foreignKeyName: "account_locations_account_id_fkey";
            columns: ["account_id"];
            isOneToOne: false;
            referencedRelation: "accounts";
            referencedColumns: ["id"];
          },
        ];
      };
      skus: {
        Row: Sku;
        Insert: {
          id?: string;
          account_id: string;
          name: string;
          price_ex_gst?: number | null;
          transfer_price?: number | null;
          units_per_pack?: number;
          commitment_per_month?: number | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          account_id?: string;
          name?: string;
          price_ex_gst?: number | null;
          transfer_price?: number | null;
          units_per_pack?: number;
          commitment_per_month?: number | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "skus_account_id_fkey";
            columns: ["account_id"];
            isOneToOne: false;
            referencedRelation: "accounts";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: Profile;
        Insert: {
          id: string;
          full_name?: string | null;
          role?: UserRole;
          account_id?: string | null;
          location_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          full_name?: string | null;
          role?: UserRole;
          account_id?: string | null;
          location_id?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "profiles_account_id_fkey";
            columns: ["account_id"];
            isOneToOne: false;
            referencedRelation: "accounts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "profiles_location_id_fkey";
            columns: ["location_id"];
            isOneToOne: false;
            referencedRelation: "account_locations";
            referencedColumns: ["id"];
          },
        ];
      };
      usage_log: {
        Row: UsageLog;
        Insert: {
          id?: string;
          account_id: string;
          location_id: string;
          sku_id: string;
          entry_date: string;
          qty: number;
          note?: string | null;
          batch_number: string;
          item_master_id?: string | null;
          source_order_line_id?: string | null;
          consumption_order_line_id?: string | null;
          logged_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          account_id?: string;
          location_id?: string;
          sku_id?: string;
          entry_date?: string;
          qty?: number;
          note?: string | null;
          batch_number?: string;
          item_master_id?: string | null;
          source_order_line_id?: string | null;
          consumption_order_line_id?: string | null;
          logged_by?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "usage_log_account_id_fkey";
            columns: ["account_id"];
            isOneToOne: false;
            referencedRelation: "accounts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "usage_log_location_id_fkey";
            columns: ["location_id"];
            isOneToOne: false;
            referencedRelation: "account_locations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "usage_log_sku_id_fkey";
            columns: ["sku_id"];
            isOneToOne: false;
            referencedRelation: "skus";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "usage_log_item_master_id_fkey";
            columns: ["item_master_id"];
            isOneToOne: false;
            referencedRelation: "item_master";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "usage_log_source_order_line_id_fkey";
            columns: ["source_order_line_id"];
            isOneToOne: false;
            referencedRelation: "order_lines";
            referencedColumns: ["id"];
          },
        ];
      };
      billing_requests: {
        Row: BillingRequest;
        Insert: {
          id?: string;
          usage_log_id?: string | null;
          order_line_id?: string | null;
          account_id: string;
          location_id: string;
          sku_id: string;
          entry_date: string;
          qty: number;
          unit_price?: number | null;
          amount?: number | null;
          status?: BillingStatus;
          requested_at?: string | null;
          billed_at?: string | null;
          invoice_number?: string | null;
          invoice_date?: string | null;
          invoice_attachment_url?: string | null;
          batch_number?: string | null;
          item_master_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          usage_log_id?: string | null;
          order_line_id?: string | null;
          account_id?: string;
          location_id?: string;
          sku_id?: string;
          entry_date?: string;
          qty?: number;
          unit_price?: number | null;
          amount?: number | null;
          status?: BillingStatus;
          requested_at?: string | null;
          billed_at?: string | null;
          invoice_number?: string | null;
          invoice_date?: string | null;
          invoice_attachment_url?: string | null;
          batch_number?: string | null;
          item_master_id?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "billing_requests_account_id_fkey";
            columns: ["account_id"];
            isOneToOne: false;
            referencedRelation: "accounts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "billing_requests_location_id_fkey";
            columns: ["location_id"];
            isOneToOne: false;
            referencedRelation: "account_locations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "billing_requests_sku_id_fkey";
            columns: ["sku_id"];
            isOneToOne: false;
            referencedRelation: "skus";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "billing_requests_item_master_id_fkey";
            columns: ["item_master_id"];
            isOneToOne: false;
            referencedRelation: "item_master";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "billing_requests_order_line_id_fkey";
            columns: ["order_line_id"];
            isOneToOne: false;
            referencedRelation: "order_lines";
            referencedColumns: ["id"];
          },
        ];
      };
      orders: {
        Row: Order;
        Insert: {
          id?: string;
          order_type: OrderType;
          status?: OrderStatus;
          account_id: string;
          location_id: string;
          po_number?: string | null;
          requested_date?: string | null;
          delivery_instruction?: string | null;
          comment?: string | null;
          tax_code?: string | null;
          order_line_text?: string | null;
          currency_code?: string;
          sales_rep?: string | null;
          partial_shipment?: boolean;
          po_attachment_url?: string | null;
          invoice_number?: string | null;
          invoice_date?: string | null;
          sales_invoice_url?: string | null;
          tracking_info?: string | null;
          dc_number?: string | null;
          dc_date?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          order_type?: OrderType;
          status?: OrderStatus;
          account_id?: string;
          location_id?: string;
          po_number?: string | null;
          requested_date?: string | null;
          delivery_instruction?: string | null;
          comment?: string | null;
          tax_code?: string | null;
          order_line_text?: string | null;
          currency_code?: string;
          sales_rep?: string | null;
          partial_shipment?: boolean;
          po_attachment_url?: string | null;
          invoice_number?: string | null;
          invoice_date?: string | null;
          sales_invoice_url?: string | null;
          tracking_info?: string | null;
          dc_number?: string | null;
          dc_date?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "orders_account_id_fkey";
            columns: ["account_id"];
            isOneToOne: false;
            referencedRelation: "accounts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "orders_location_id_fkey";
            columns: ["location_id"];
            isOneToOne: false;
            referencedRelation: "account_locations";
            referencedColumns: ["id"];
          },
        ];
      };
      order_lines: {
        Row: OrderLine;
        Insert: {
          id?: string;
          order_id: string;
          sku_id: string;
          qty: number;
          uom?: string;
          net_price?: number | null;
          notes?: string | null;
          source_order_line_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          order_id?: string;
          sku_id?: string;
          qty?: number;
          uom?: string;
          net_price?: number | null;
          notes?: string | null;
          source_order_line_id?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "order_lines_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "order_lines_sku_id_fkey";
            columns: ["sku_id"];
            isOneToOne: false;
            referencedRelation: "skus";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "order_lines_source_order_line_id_fkey";
            columns: ["source_order_line_id"];
            isOneToOne: false;
            referencedRelation: "order_lines";
            referencedColumns: ["id"];
          },
        ];
      };
      item_master: {
        Row: ItemMaster;
        Insert: {
          id?: string;
          gtin: string;
          name: string;
          account_id?: string | null;
          price_ex_gst?: number | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          gtin?: string;
          name?: string;
          account_id?: string | null;
          price_ex_gst?: number | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "item_master_account_id_fkey";
            columns: ["account_id"];
            isOneToOne: false;
            referencedRelation: "accounts";
            referencedColumns: ["id"];
          },
        ];
      };
      stock_movements: {
        Row: StockMovement;
        Insert: {
          id?: string;
          item_id: string;
          category: MovementCategory;
          qty: number;
          hospital_account_id?: string | null;
          batch_number?: string | null;
          expiry_date?: string | null;
          tally_invoice_line_id?: string | null;
          billing_request_id?: string | null;
          order_line_id?: string | null;
          scanned_by?: string | null;
          notes?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          item_id?: string;
          category?: MovementCategory;
          qty?: number;
          hospital_account_id?: string | null;
          batch_number?: string | null;
          expiry_date?: string | null;
          tally_invoice_line_id?: string | null;
          billing_request_id?: string | null;
          order_line_id?: string | null;
          scanned_by?: string | null;
          notes?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "stock_movements_item_id_fkey";
            columns: ["item_id"];
            isOneToOne: false;
            referencedRelation: "item_master";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "stock_movements_hospital_account_id_fkey";
            columns: ["hospital_account_id"];
            isOneToOne: false;
            referencedRelation: "accounts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "stock_movements_tally_invoice_line_id_fkey";
            columns: ["tally_invoice_line_id"];
            isOneToOne: false;
            referencedRelation: "tally_invoice_lines";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "stock_movements_billing_request_id_fkey";
            columns: ["billing_request_id"];
            isOneToOne: false;
            referencedRelation: "billing_requests";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "stock_movements_order_line_id_fkey";
            columns: ["order_line_id"];
            isOneToOne: false;
            referencedRelation: "order_lines";
            referencedColumns: ["id"];
          },
        ];
      };
      tally_invoice_lines: {
        Row: TallyInvoiceLine;
        Insert: {
          id?: string;
          invoice_no: string;
          invoice_date: string;
          account_id: string;
          item_id?: string | null;
          sku_id?: string | null;
          description_raw: string;
          qty: number;
          rate?: number | null;
          batch_number?: string | null;
          expiry_date?: string | null;
          imported_by?: string | null;
          document_type?: "invoice" | "credit_note" | "debit_note";
          related_invoice_no?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          invoice_no?: string;
          invoice_date?: string;
          account_id?: string;
          item_id?: string | null;
          sku_id?: string | null;
          description_raw?: string;
          qty?: number;
          rate?: number | null;
          batch_number?: string | null;
          expiry_date?: string | null;
          imported_by?: string | null;
          document_type?: "invoice" | "credit_note" | "debit_note";
          related_invoice_no?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "tally_invoice_lines_account_id_fkey";
            columns: ["account_id"];
            isOneToOne: false;
            referencedRelation: "accounts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tally_invoice_lines_item_id_fkey";
            columns: ["item_id"];
            isOneToOne: false;
            referencedRelation: "item_master";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tally_invoice_lines_sku_id_fkey";
            columns: ["sku_id"];
            isOneToOne: false;
            referencedRelation: "skus";
            referencedColumns: ["id"];
          },
        ];
      };
      receivable_payments: {
        Row: ReceivablePayment;
        Insert: {
          id?: string;
          invoice_no: string;
          amount_received: number;
          utr: string;
          payment_date: string;
          recorded_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          invoice_no?: string;
          amount_received?: number;
          utr?: string;
          payment_date?: string;
          recorded_by?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "receivable_payments_recorded_by_fkey";
            columns: ["recorded_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      commitment_adjustments: {
        Row: CommitmentAdjustment;
        Insert: {
          id?: string;
          account_id: string;
          sku_id: string;
          period_month: string;
          actual_qty: number;
          commitment_qty: number;
          adjustment_type: "credit" | "debit";
          adjustment_amount: number;
          status?: "pending" | "raised";
          note_no?: string | null;
          raised_date?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          account_id?: string;
          sku_id?: string;
          period_month?: string;
          actual_qty?: number;
          commitment_qty?: number;
          adjustment_type?: "credit" | "debit";
          adjustment_amount?: number;
          status?: "pending" | "raised";
          note_no?: string | null;
          raised_date?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "commitment_adjustments_account_id_fkey";
            columns: ["account_id"];
            isOneToOne: false;
            referencedRelation: "accounts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "commitment_adjustments_sku_id_fkey";
            columns: ["sku_id"];
            isOneToOne: false;
            referencedRelation: "skus";
            referencedColumns: ["id"];
          },
        ];
      };
      assets: {
        Row: Asset;
        Insert: {
          id?: string;
          account_id: string;
          location_id?: string | null;
          asset_name: string;
          category?: AssetCategory;
          agreement_reference?: string | null;
          serial_number?: string | null;
          equipment_value?: number | null;
          invoice_value?: number | null;
          po_raised_to_zeiss?: boolean;
          po_to_zeiss_number?: string | null;
          po_to_zeiss_date?: string | null;
          payment_received_from_hospital?: boolean;
          payment_received_amount?: number | null;
          payment_received_date?: string | null;
          po_received_from_hospital?: boolean;
          po_from_hospital_number?: string | null;
          po_from_hospital_date?: string | null;
          po_from_hospital_price?: number | null;
          status?: AssetStatus;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          account_id?: string;
          location_id?: string | null;
          asset_name?: string;
          category?: AssetCategory;
          agreement_reference?: string | null;
          serial_number?: string | null;
          equipment_value?: number | null;
          invoice_value?: number | null;
          po_raised_to_zeiss?: boolean;
          po_to_zeiss_number?: string | null;
          po_to_zeiss_date?: string | null;
          payment_received_from_hospital?: boolean;
          payment_received_amount?: number | null;
          payment_received_date?: string | null;
          po_received_from_hospital?: boolean;
          po_from_hospital_number?: string | null;
          po_from_hospital_date?: string | null;
          po_from_hospital_price?: number | null;
          status?: AssetStatus;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "assets_account_id_fkey";
            columns: ["account_id"];
            isOneToOne: false;
            referencedRelation: "accounts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "assets_location_id_fkey";
            columns: ["location_id"];
            isOneToOne: false;
            referencedRelation: "account_locations";
            referencedColumns: ["id"];
          },
        ];
      };
      purchase_orders: {
        Row: PurchaseOrder;
        Insert: {
          id?: string;
          po_number: string;
          created_by?: string | null;
          created_at?: string;
          gst_percent?: number | null;
          delivery?: string | null;
          payment?: string | null;
          warranty?: string | null;
          notes?: string | null;
          to_emails?: string | null;
          cc_emails?: string | null;
        };
        Update: {
          id?: string;
          po_number?: string;
          created_by?: string | null;
          created_at?: string;
          gst_percent?: number | null;
          delivery?: string | null;
          payment?: string | null;
          warranty?: string | null;
          notes?: string | null;
          to_emails?: string | null;
          cc_emails?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "purchase_orders_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      purchase_order_lines: {
        Row: PurchaseOrderLine;
        Insert: {
          id?: string;
          purchase_order_id: string;
          item_id?: string | null;
          item_name: string;
          qty: number;
          unit_price?: number | null;
          hsn?: string | null;
        };
        Update: {
          id?: string;
          purchase_order_id?: string;
          item_id?: string | null;
          item_name?: string;
          qty?: number;
          unit_price?: number | null;
          hsn?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "purchase_order_lines_purchase_order_id_fkey";
            columns: ["purchase_order_id"];
            isOneToOne: false;
            referencedRelation: "purchase_orders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "purchase_order_lines_item_id_fkey";
            columns: ["item_id"];
            isOneToOne: false;
            referencedRelation: "item_master";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      stock_balance: {
        Row: StockBalance;
        Relationships: [];
      };
      stock_balance_by_batch: {
        Row: StockBalanceByBatch;
        Relationships: [];
      };
      consignment_balance: {
        Row: ConsignmentBalance;
        Relationships: [
          {
            foreignKeyName: "consignment_balance_account_id_fkey";
            columns: ["account_id"];
            isOneToOne: false;
            referencedRelation: "accounts";
            referencedColumns: ["id"];
          },
        ];
      };
      consignment_balance_by_batch: {
        Row: ConsignmentBalanceByBatch;
        Relationships: [
          {
            foreignKeyName: "consignment_balance_by_batch_account_id_fkey";
            columns: ["account_id"];
            isOneToOne: false;
            referencedRelation: "accounts";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Functions: Record<string, never>;
  };
}
