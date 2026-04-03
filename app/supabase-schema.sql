-- Xero Documents App - Database Schema
-- Run this in Supabase SQL Editor

-- Enable UUID generation
create extension if not exists "uuid-ossp";

-- Xero tenant/org connections
create table xero_connections (
  id uuid primary key default uuid_generate_v4(),
  tenant_id text not null unique,
  tenant_name text,
  short_code text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Contacts synced from Xero
create table contacts (
  id uuid primary key default uuid_generate_v4(),
  xero_contact_id text unique,
  tenant_id text not null references xero_connections(tenant_id),
  name text not null,
  email text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Documents (invoices, quotes, purchase orders)
create table documents (
  id uuid primary key default uuid_generate_v4(),
  xero_id text,
  tenant_id text not null references xero_connections(tenant_id),
  doc_type text not null check (doc_type in ('invoice', 'quote', 'po')),
  doc_number text,
  contact_id uuid references contacts(id),
  contact_name text not null,
  contact_email text,
  date date not null,
  due_date date,
  reference text,
  currency_code text default 'ZAR',
  subtotal numeric(12,2) default 0,
  total numeric(12,2) default 0,
  status text default 'DRAFT',
  xero_status text,
  created_by text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Line items for documents
create table line_items (
  id uuid primary key default uuid_generate_v4(),
  document_id uuid not null references documents(id) on delete cascade,
  sort_order integer default 0,
  description text,
  account_code text,
  tracking_category_id text,
  tracking_option_id text,
  quantity numeric(10,2) default 1,
  unit_amount numeric(12,2) default 0,
  line_amount numeric(12,2) default 0,
  created_at timestamptz default now()
);

-- Audit log - tracks all actions
create table audit_log (
  id uuid primary key default uuid_generate_v4(),
  tenant_id text,
  entity_type text not null, -- 'document', 'contact', 'connection'
  entity_id uuid,
  action text not null, -- 'create', 'update', 'delete', 'email', 'pdf_download'
  actor text, -- email or user identifier
  details jsonb, -- additional context
  created_at timestamptz default now()
);

-- Indexes
create index idx_documents_tenant on documents(tenant_id);
create index idx_documents_type on documents(doc_type);
create index idx_documents_status on documents(status);
create index idx_documents_date on documents(date desc);
create index idx_line_items_document on line_items(document_id);
create index idx_audit_log_entity on audit_log(entity_type, entity_id);
create index idx_audit_log_tenant on audit_log(tenant_id);
create index idx_audit_log_created on audit_log(created_at desc);
create index idx_contacts_tenant on contacts(tenant_id);

-- Auto-update updated_at timestamps
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger tr_xero_connections_updated
  before update on xero_connections
  for each row execute function update_updated_at();

create trigger tr_contacts_updated
  before update on contacts
  for each row execute function update_updated_at();

create trigger tr_documents_updated
  before update on documents
  for each row execute function update_updated_at();

-- Auto-create audit log entries for documents
create or replace function audit_document_changes()
returns trigger as $$
begin
  if (tg_op = 'INSERT') then
    insert into audit_log (tenant_id, entity_type, entity_id, action, actor, details)
    values (new.tenant_id, 'document', new.id, 'create', new.created_by,
      jsonb_build_object('doc_type', new.doc_type, 'doc_number', new.doc_number, 'total', new.total));
  elsif (tg_op = 'UPDATE') then
    insert into audit_log (tenant_id, entity_type, entity_id, action, actor, details)
    values (new.tenant_id, 'document', new.id, 'update', new.created_by,
      jsonb_build_object('doc_type', new.doc_type, 'doc_number', new.doc_number,
        'old_status', old.status, 'new_status', new.status));
  elsif (tg_op = 'DELETE') then
    insert into audit_log (tenant_id, entity_type, entity_id, action, details)
    values (old.tenant_id, 'document', old.id, 'delete',
      jsonb_build_object('doc_type', old.doc_type, 'doc_number', old.doc_number));
  end if;
  return coalesce(new, old);
end;
$$ language plpgsql;

create trigger tr_documents_audit
  after insert or update or delete on documents
  for each row execute function audit_document_changes();

-- Row Level Security (prep for multi-user)
alter table xero_connections enable row level security;
alter table contacts enable row level security;
alter table documents enable row level security;
alter table line_items enable row level security;
alter table audit_log enable row level security;

-- For now, allow all access via service role (worker uses service role key)
-- These policies will be tightened when we add user auth
create policy "Allow all for service role" on xero_connections for all using (true);
create policy "Allow all for service role" on contacts for all using (true);
create policy "Allow all for service role" on documents for all using (true);
create policy "Allow all for service role" on line_items for all using (true);
create policy "Allow all for service role" on audit_log for all using (true);
