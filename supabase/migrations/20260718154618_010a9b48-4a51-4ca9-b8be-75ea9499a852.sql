
-- ENUMS
CREATE TYPE public.app_role AS ENUM ('owner', 'manager', 'receptionist', 'staff');
CREATE TYPE public.subscription_plan AS ENUM ('starter', 'growth', 'enterprise');
CREATE TYPE public.subscription_status AS ENUM ('active', 'expiring', 'expired', 'trial');
CREATE TYPE public.billing_cycle AS ENUM ('monthly', 'yearly');
CREATE TYPE public.appointment_status AS ENUM ('scheduled', 'completed', 'cancelled', 'no_show');
CREATE TYPE public.stock_movement_type AS ENUM ('restock', 'usage', 'waste', 'adjustment');
CREATE TYPE public.payment_method AS ENUM ('cash', 'card', 'bank_transfer');

-- Shared updated_at trigger
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public
AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

-- BRANDS
CREATE TABLE public.brands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL,
  name TEXT NOT NULL,
  plan public.subscription_plan NOT NULL DEFAULT 'starter',
  subscription_status public.subscription_status NOT NULL DEFAULT 'trial',
  billing_cycle public.billing_cycle NOT NULL DEFAULT 'monthly',
  renewal_date DATE,
  max_locations INT NOT NULL DEFAULT 1,
  max_staff_accounts INT NOT NULL DEFAULT 3,
  currency TEXT NOT NULL DEFAULT 'QAR',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.brands TO authenticated;
GRANT ALL ON public.brands TO service_role;
ALTER TABLE public.brands ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_brands_updated_at BEFORE UPDATE ON public.brands
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- LOCATIONS
CREATE TABLE public.locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id UUID NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  address TEXT,
  phone TEXT,
  timezone TEXT NOT NULL DEFAULT 'Asia/Qatar',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.locations TO authenticated;
GRANT ALL ON public.locations TO service_role;
ALTER TABLE public.locations ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_locations_updated_at BEFORE UPDATE ON public.locations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE INDEX idx_locations_brand ON public.locations(brand_id);

-- PROFILES
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY,
  full_name TEXT,
  phone TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_profiles_updated_at BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$ BEGIN
  INSERT INTO public.profiles (id, full_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', ''))
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END; $$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- USER ROLES
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  role public.app_role NOT NULL,
  brand_id UUID NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  location_id UUID REFERENCES public.locations(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role, brand_id, location_id)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_user_roles_user ON public.user_roles(user_id);
CREATE INDEX idx_user_roles_brand ON public.user_roles(brand_id);
CREATE INDEX idx_user_roles_location ON public.user_roles(location_id);

-- PLATFORM ADMINS
CREATE TABLE public.platform_admins (
  user_id UUID PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.platform_admins TO authenticated;
GRANT ALL ON public.platform_admins TO service_role;
ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;

-- HELPERS
CREATE OR REPLACE FUNCTION public.is_platform_admin(_user_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id = _user_id) $$;

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role) $$;

CREATE OR REPLACE FUNCTION public.is_brand_member(_user_id UUID, _brand_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND brand_id = _brand_id) $$;

CREATE OR REPLACE FUNCTION public.is_brand_owner(_user_id UUID, _brand_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND brand_id = _brand_id AND role = 'owner') $$;

CREATE OR REPLACE FUNCTION public.is_brand_manager_or_owner(_user_id UUID, _brand_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND brand_id = _brand_id AND role IN ('owner','manager')) $$;

CREATE OR REPLACE FUNCTION public.has_location_access(_user_id UUID, _location_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    JOIN public.locations l ON l.brand_id = ur.brand_id
    WHERE ur.user_id = _user_id AND l.id = _location_id
      AND (ur.role = 'owner' OR ur.location_id = _location_id)
  );
$$;

CREATE OR REPLACE FUNCTION public.can_manage_location(_user_id UUID, _location_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    JOIN public.locations l ON l.brand_id = ur.brand_id
    WHERE ur.user_id = _user_id AND l.id = _location_id
      AND ur.role IN ('owner','manager','receptionist')
      AND (ur.role = 'owner' OR ur.location_id = _location_id)
  );
$$;

CREATE OR REPLACE FUNCTION public.get_user_brand(_user_id UUID)
RETURNS UUID LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT brand_id FROM public.user_roles WHERE user_id = _user_id LIMIT 1 $$;

-- POLICIES: brands
CREATE POLICY "Platform admins full access on brands" ON public.brands FOR ALL TO authenticated
  USING (public.is_platform_admin(auth.uid())) WITH CHECK (public.is_platform_admin(auth.uid()));
CREATE POLICY "Brand members view their brand" ON public.brands FOR SELECT TO authenticated
  USING (public.is_brand_member(auth.uid(), id));
CREATE POLICY "Owner creates their own brand" ON public.brands FOR INSERT TO authenticated
  WITH CHECK (owner_user_id = auth.uid());
CREATE POLICY "Owner updates own brand" ON public.brands FOR UPDATE TO authenticated
  USING (public.is_brand_owner(auth.uid(), id)) WITH CHECK (public.is_brand_owner(auth.uid(), id));

-- POLICIES: locations
CREATE POLICY "Platform admins full access on locations" ON public.locations FOR ALL TO authenticated
  USING (public.is_platform_admin(auth.uid())) WITH CHECK (public.is_platform_admin(auth.uid()));
CREATE POLICY "Users view locations they have access to" ON public.locations FOR SELECT TO authenticated
  USING (public.has_location_access(auth.uid(), id));
CREATE POLICY "Owners manage locations" ON public.locations FOR ALL TO authenticated
  USING (public.is_brand_owner(auth.uid(), brand_id)) WITH CHECK (public.is_brand_owner(auth.uid(), brand_id));

-- POLICIES: profiles
CREATE POLICY "Users view own profile" ON public.profiles FOR SELECT TO authenticated USING (id = auth.uid());
CREATE POLICY "Users update own profile" ON public.profiles FOR UPDATE TO authenticated
  USING (id = auth.uid()) WITH CHECK (id = auth.uid());
CREATE POLICY "Users insert own profile" ON public.profiles FOR INSERT TO authenticated WITH CHECK (id = auth.uid());
CREATE POLICY "Platform admins view all profiles" ON public.profiles FOR SELECT TO authenticated
  USING (public.is_platform_admin(auth.uid()));

-- POLICIES: user_roles
CREATE POLICY "Users view own role rows" ON public.user_roles FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Owners view role rows in brand" ON public.user_roles FOR SELECT TO authenticated
  USING (public.is_brand_owner(auth.uid(), brand_id));
CREATE POLICY "Managers view roles at their location" ON public.user_roles FOR SELECT TO authenticated
  USING (location_id IS NOT NULL AND public.has_role(auth.uid(), 'manager') AND public.has_location_access(auth.uid(), location_id));
CREATE POLICY "Platform admins full access on user_roles" ON public.user_roles FOR ALL TO authenticated
  USING (public.is_platform_admin(auth.uid())) WITH CHECK (public.is_platform_admin(auth.uid()));
CREATE POLICY "Owners manage roles in brand" ON public.user_roles FOR ALL TO authenticated
  USING (public.is_brand_owner(auth.uid(), brand_id)) WITH CHECK (public.is_brand_owner(auth.uid(), brand_id));
CREATE POLICY "Managers assign staff at their location" ON public.user_roles FOR INSERT TO authenticated
  WITH CHECK (role IN ('receptionist','staff') AND location_id IS NOT NULL AND public.has_role(auth.uid(), 'manager') AND public.has_location_access(auth.uid(), location_id));
CREATE POLICY "Managers remove staff at their location" ON public.user_roles FOR DELETE TO authenticated
  USING (role IN ('receptionist','staff') AND location_id IS NOT NULL AND public.has_role(auth.uid(), 'manager') AND public.has_location_access(auth.uid(), location_id));
CREATE POLICY "User creates own owner role" ON public.user_roles FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND role = 'owner' AND EXISTS (SELECT 1 FROM public.brands b WHERE b.id = brand_id AND b.owner_user_id = auth.uid()));

CREATE POLICY "Users check own admin flag" ON public.platform_admins FOR SELECT TO authenticated USING (user_id = auth.uid());

-- CLIENTS
CREATE TABLE public.clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id UUID NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  notes TEXT,
  no_show_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.clients TO authenticated;
GRANT ALL ON public.clients TO service_role;
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_clients_updated_at BEFORE UPDATE ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE INDEX idx_clients_brand ON public.clients(brand_id);

CREATE POLICY "Brand non-staff view clients" ON public.clients FOR SELECT TO authenticated
  USING (public.is_brand_member(auth.uid(), brand_id) AND NOT public.has_role(auth.uid(), 'staff'));
CREATE POLICY "Brand non-staff manage clients" ON public.clients FOR ALL TO authenticated
  USING (public.is_brand_member(auth.uid(), brand_id) AND (public.has_role(auth.uid(), 'owner') OR public.has_role(auth.uid(), 'manager') OR public.has_role(auth.uid(), 'receptionist')))
  WITH CHECK (public.is_brand_member(auth.uid(), brand_id) AND (public.has_role(auth.uid(), 'owner') OR public.has_role(auth.uid(), 'manager') OR public.has_role(auth.uid(), 'receptionist')));

-- SERVICES
CREATE TABLE public.services (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id UUID NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  name TEXT NOT NULL, description TEXT, category TEXT,
  duration_minutes INT NOT NULL DEFAULT 60,
  default_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'QAR',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.services TO authenticated;
GRANT ALL ON public.services TO service_role;
ALTER TABLE public.services ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_services_updated_at BEFORE UPDATE ON public.services
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE INDEX idx_services_brand ON public.services(brand_id);

CREATE POLICY "Brand members view services" ON public.services FOR SELECT TO authenticated
  USING (public.is_brand_member(auth.uid(), brand_id));
CREATE POLICY "Owner manages services" ON public.services FOR ALL TO authenticated
  USING (public.is_brand_owner(auth.uid(), brand_id)) WITH CHECK (public.is_brand_owner(auth.uid(), brand_id));

-- SERVICE PRICE OVERRIDES
CREATE TABLE public.service_location_prices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id UUID NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  location_id UUID NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  price NUMERIC(12,2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'QAR',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (service_id, location_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.service_location_prices TO authenticated;
GRANT ALL ON public.service_location_prices TO service_role;
ALTER TABLE public.service_location_prices ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_service_prices_updated_at BEFORE UPDATE ON public.service_location_prices
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE POLICY "Brand members view location prices" ON public.service_location_prices FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.services s WHERE s.id = service_id AND public.is_brand_member(auth.uid(), s.brand_id)));
CREATE POLICY "Owner manages location prices" ON public.service_location_prices FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.services s WHERE s.id = service_id AND public.is_brand_owner(auth.uid(), s.brand_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.services s WHERE s.id = service_id AND public.is_brand_owner(auth.uid(), s.brand_id)));

-- PRODUCTS
CREATE TABLE public.products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id UUID NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  name TEXT NOT NULL, sku TEXT, supplier TEXT,
  unit TEXT NOT NULL DEFAULT 'unit',
  cost_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'QAR',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.products TO authenticated;
GRANT ALL ON public.products TO service_role;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_products_updated_at BEFORE UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE INDEX idx_products_brand ON public.products(brand_id);

CREATE POLICY "Brand non-staff view products" ON public.products FOR SELECT TO authenticated
  USING (public.is_brand_member(auth.uid(), brand_id) AND NOT public.has_role(auth.uid(), 'staff'));
CREATE POLICY "Owner/Manager manage products" ON public.products FOR ALL TO authenticated
  USING (public.is_brand_manager_or_owner(auth.uid(), brand_id)) WITH CHECK (public.is_brand_manager_or_owner(auth.uid(), brand_id));

-- LOCATION STOCK
CREATE TABLE public.location_stock (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id UUID NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  quantity NUMERIC(12,2) NOT NULL DEFAULT 0,
  low_stock_threshold NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (location_id, product_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.location_stock TO authenticated;
GRANT ALL ON public.location_stock TO service_role;
ALTER TABLE public.location_stock ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_location_stock_updated_at BEFORE UPDATE ON public.location_stock
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE INDEX idx_location_stock_location ON public.location_stock(location_id);

CREATE POLICY "Non-staff view stock" ON public.location_stock FOR SELECT TO authenticated
  USING (public.has_location_access(auth.uid(), location_id) AND NOT public.has_role(auth.uid(), 'staff'));
CREATE POLICY "Owner/Manager manage stock" ON public.location_stock FOR ALL TO authenticated
  USING (public.has_location_access(auth.uid(), location_id) AND (public.has_role(auth.uid(), 'owner') OR public.has_role(auth.uid(), 'manager')))
  WITH CHECK (public.has_location_access(auth.uid(), location_id) AND (public.has_role(auth.uid(), 'owner') OR public.has_role(auth.uid(), 'manager')));

-- STOCK MOVEMENTS
CREATE TABLE public.stock_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id UUID NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  movement_type public.stock_movement_type NOT NULL,
  quantity NUMERIC(12,2) NOT NULL,
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.stock_movements TO authenticated;
GRANT ALL ON public.stock_movements TO service_role;
ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_stock_moves_location ON public.stock_movements(location_id);

CREATE POLICY "Non-staff view stock movements" ON public.stock_movements FOR SELECT TO authenticated
  USING (public.has_location_access(auth.uid(), location_id) AND NOT public.has_role(auth.uid(), 'staff'));
CREATE POLICY "Owner/Manager insert stock movements" ON public.stock_movements FOR INSERT TO authenticated
  WITH CHECK (public.has_location_access(auth.uid(), location_id) AND (public.has_role(auth.uid(), 'owner') OR public.has_role(auth.uid(), 'manager')) AND created_by = auth.uid());

-- STAFF SCHEDULES
CREATE TABLE public.staff_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  location_id UUID NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  day_of_week INT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.staff_schedules TO authenticated;
GRANT ALL ON public.staff_schedules TO service_role;
ALTER TABLE public.staff_schedules ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_staff_schedules_updated_at BEFORE UPDATE ON public.staff_schedules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE POLICY "Own schedule visible" ON public.staff_schedules FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.can_manage_location(auth.uid(), location_id));
CREATE POLICY "Owner/Manager manage schedules" ON public.staff_schedules FOR ALL TO authenticated
  USING (public.has_location_access(auth.uid(), location_id) AND (public.has_role(auth.uid(), 'owner') OR public.has_role(auth.uid(), 'manager')))
  WITH CHECK (public.has_location_access(auth.uid(), location_id) AND (public.has_role(auth.uid(), 'owner') OR public.has_role(auth.uid(), 'manager')));

-- STAFF LEAVE
CREATE TABLE public.staff_leave (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  location_id UUID NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.staff_leave TO authenticated;
GRANT ALL ON public.staff_leave TO service_role;
ALTER TABLE public.staff_leave ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Leave visible to user or managers" ON public.staff_leave FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.can_manage_location(auth.uid(), location_id));
CREATE POLICY "Owner/Manager manage leave" ON public.staff_leave FOR ALL TO authenticated
  USING (public.has_location_access(auth.uid(), location_id) AND (public.has_role(auth.uid(), 'owner') OR public.has_role(auth.uid(), 'manager')))
  WITH CHECK (public.has_location_access(auth.uid(), location_id) AND (public.has_role(auth.uid(), 'owner') OR public.has_role(auth.uid(), 'manager')));

-- APPOINTMENTS
CREATE TABLE public.appointments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id UUID NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  location_id UUID NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE RESTRICT,
  staff_user_id UUID NOT NULL,
  service_id UUID REFERENCES public.services(id) ON DELETE SET NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  status public.appointment_status NOT NULL DEFAULT 'scheduled',
  notes TEXT,
  price NUMERIC(12,2),
  currency TEXT NOT NULL DEFAULT 'QAR',
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.appointments TO authenticated;
GRANT ALL ON public.appointments TO service_role;
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_appointments_updated_at BEFORE UPDATE ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE INDEX idx_appts_location_time ON public.appointments(location_id, starts_at);
CREATE INDEX idx_appts_staff_time ON public.appointments(staff_user_id, starts_at);
CREATE INDEX idx_appts_client ON public.appointments(client_id);

CREATE POLICY "Staff view own appointments" ON public.appointments FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'staff') AND staff_user_id = auth.uid());
CREATE POLICY "Non-staff view location appointments" ON public.appointments FOR SELECT TO authenticated
  USING (public.has_location_access(auth.uid(), location_id) AND NOT public.has_role(auth.uid(), 'staff'));
CREATE POLICY "Manageable roles create appointments" ON public.appointments FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_location(auth.uid(), location_id));
CREATE POLICY "Manageable roles update appointments" ON public.appointments FOR UPDATE TO authenticated
  USING (public.can_manage_location(auth.uid(), location_id)) WITH CHECK (public.can_manage_location(auth.uid(), location_id));
CREATE POLICY "Manageable roles delete appointments" ON public.appointments FOR DELETE TO authenticated
  USING (public.can_manage_location(auth.uid(), location_id));

-- Staff-can-view-client-of-own-appointment (created here since it references appointments)
CREATE POLICY "Staff view clients from own appointments" ON public.clients FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'staff')
    AND EXISTS (SELECT 1 FROM public.appointments a WHERE a.client_id = clients.id AND a.staff_user_id = auth.uid())
  );

-- SERVICE RECORDS
CREATE TABLE public.service_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id UUID NOT NULL REFERENCES public.appointments(id) ON DELETE CASCADE,
  technician_user_id UUID NOT NULL,
  service_performed TEXT NOT NULL,
  formula_notes TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.service_records TO authenticated;
GRANT ALL ON public.service_records TO service_role;
ALTER TABLE public.service_records ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_service_records_updated_at BEFORE UPDATE ON public.service_records
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE POLICY "Read service records for accessible appointments" ON public.service_records FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.appointments a WHERE a.id = appointment_id
      AND ((public.has_role(auth.uid(), 'staff') AND a.staff_user_id = auth.uid())
        OR (NOT public.has_role(auth.uid(), 'staff') AND public.has_location_access(auth.uid(), a.location_id))))
  );
CREATE POLICY "Technician logs own service record" ON public.service_records FOR INSERT TO authenticated
  WITH CHECK (
    technician_user_id = auth.uid()
    AND EXISTS (SELECT 1 FROM public.appointments a WHERE a.id = appointment_id AND a.staff_user_id = auth.uid() AND a.status = 'completed')
  );
CREATE POLICY "Technician updates own service record" ON public.service_records FOR UPDATE TO authenticated
  USING (technician_user_id = auth.uid()) WITH CHECK (technician_user_id = auth.uid());
CREATE POLICY "Managers update service records" ON public.service_records FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.appointments a WHERE a.id = appointment_id AND public.can_manage_location(auth.uid(), a.location_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.appointments a WHERE a.id = appointment_id AND public.can_manage_location(auth.uid(), a.location_id)));

-- SERVICE RECORD PRODUCTS
CREATE TABLE public.service_record_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_record_id UUID NOT NULL REFERENCES public.service_records(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  quantity NUMERIC(12,2) NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.service_record_products TO authenticated;
GRANT ALL ON public.service_record_products TO service_role;
ALTER TABLE public.service_record_products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "View service record products" ON public.service_record_products FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.service_records sr JOIN public.appointments a ON a.id = sr.appointment_id
      WHERE sr.id = service_record_id
      AND ((public.has_role(auth.uid(), 'staff') AND a.staff_user_id = auth.uid())
        OR (NOT public.has_role(auth.uid(), 'staff') AND public.has_location_access(auth.uid(), a.location_id))))
  );
CREATE POLICY "Technician manages own service record products" ON public.service_record_products FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.service_records sr WHERE sr.id = service_record_id AND sr.technician_user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.service_records sr WHERE sr.id = service_record_id AND sr.technician_user_id = auth.uid()));

-- INCOME RECORDS
CREATE TABLE public.income_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id UUID NOT NULL REFERENCES public.appointments(id) ON DELETE CASCADE,
  location_id UUID NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  brand_id UUID NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  amount NUMERIC(12,2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'QAR',
  method public.payment_method NOT NULL,
  collected_by UUID,
  collected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.income_records TO authenticated;
GRANT ALL ON public.income_records TO service_role;
ALTER TABLE public.income_records ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_income_location_time ON public.income_records(location_id, collected_at);
CREATE INDEX idx_income_brand_time ON public.income_records(brand_id, collected_at);

CREATE POLICY "Owner views brand income" ON public.income_records FOR SELECT TO authenticated
  USING (public.is_brand_owner(auth.uid(), brand_id));
CREATE POLICY "Location managers view location income" ON public.income_records FOR SELECT TO authenticated
  USING ((public.has_role(auth.uid(), 'manager') OR public.has_role(auth.uid(), 'receptionist')) AND public.has_location_access(auth.uid(), location_id));
CREATE POLICY "Manageable roles log income" ON public.income_records FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_location(auth.uid(), location_id) AND collected_by = auth.uid());
CREATE POLICY "Owner/Manager amend income" ON public.income_records FOR UPDATE TO authenticated
  USING (public.has_location_access(auth.uid(), location_id) AND (public.has_role(auth.uid(), 'owner') OR public.has_role(auth.uid(), 'manager')))
  WITH CHECK (public.has_location_access(auth.uid(), location_id) AND (public.has_role(auth.uid(), 'owner') OR public.has_role(auth.uid(), 'manager')));
