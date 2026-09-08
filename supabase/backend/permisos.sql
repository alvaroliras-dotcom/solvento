-- POLITICA companies :: companies_delete_owner
create policy "companies_delete_owner" on public.companies for DELETE to authenticated
  using ((EXISTS ( SELECT 1
   FROM memberships m
  WHERE ((m.company_id = companies.id) AND (m.user_id = auth.uid()) AND (m.role = 'owner'::membership_role)))));

-- POLITICA companies :: companies_insert_self
create policy "companies_insert_self" on public.companies for INSERT to authenticated
  with check ((created_by = auth.uid()));

-- POLITICA companies :: companies_select_member
create policy "companies_select_member" on public.companies for SELECT to authenticated
  using ((EXISTS ( SELECT 1
   FROM memberships m
  WHERE ((m.company_id = companies.id) AND (m.user_id = auth.uid())))));

-- POLITICA companies :: companies_update_owner
create policy "companies_update_owner" on public.companies for UPDATE to authenticated
  using ((EXISTS ( SELECT 1
   FROM memberships m
  WHERE ((m.company_id = companies.id) AND (m.user_id = auth.uid()) AND (m.role = 'owner'::membership_role)))))
  with check ((EXISTS ( SELECT 1
   FROM memberships m
  WHERE ((m.company_id = companies.id) AND (m.user_id = auth.uid()) AND (m.role = 'owner'::membership_role)))));

-- POLITICA company_holidays :: festivos_alta_admin
create policy "festivos_alta_admin" on public.company_holidays for INSERT to authenticated
  with check (is_company_hr_or_owner(company_id));

-- POLITICA company_holidays :: festivos_baja_admin
create policy "festivos_baja_admin" on public.company_holidays for DELETE to authenticated
  using (is_company_hr_or_owner(company_id));

-- POLITICA company_holidays :: festivos_cambio_admin
create policy "festivos_cambio_admin" on public.company_holidays for UPDATE to authenticated
  using (is_company_hr_or_owner(company_id))
  with check (is_company_hr_or_owner(company_id));

-- POLITICA company_holidays :: festivos_lectura_miembros
create policy "festivos_lectura_miembros" on public.company_holidays for SELECT to authenticated
  using (is_company_member(company_id));

-- POLITICA company_work_calendar :: calendario_alta_admin
create policy "calendario_alta_admin" on public.company_work_calendar for INSERT to authenticated
  with check (is_company_hr_or_owner(company_id));

-- POLITICA company_work_calendar :: calendario_cambio_admin
create policy "calendario_cambio_admin" on public.company_work_calendar for UPDATE to authenticated
  using (is_company_hr_or_owner(company_id))
  with check (is_company_hr_or_owner(company_id));

-- POLITICA company_work_calendar :: calendario_lectura_miembros
create policy "calendario_lectura_miembros" on public.company_work_calendar for SELECT to authenticated
  using (is_company_member(company_id));

-- POLITICA memberships :: Block delete
create policy "Block delete" on public.memberships for DELETE to public
  using (false);

-- POLITICA memberships :: Block insert
create policy "Block insert" on public.memberships for INSERT to public
  with check (false);

-- POLITICA memberships :: Block update
create policy "Block update" on public.memberships for UPDATE to public
  using (false);

-- POLITICA memberships :: Users can view own membership
create policy "Users can view own membership" on public.memberships for SELECT to public
  using ((user_id = auth.uid()));

-- POLITICA memberships :: Users can view their memberships
create policy "Users can view their memberships" on public.memberships for SELECT to public
  using ((auth.uid() = user_id));

-- POLITICA profiles :: profiles_select_own
create policy "profiles_select_own" on public.profiles for SELECT to authenticated
  using ((id = auth.uid()));

-- POLITICA profiles :: profiles_update_own
create policy "profiles_update_own" on public.profiles for UPDATE to authenticated
  using ((id = auth.uid()))
  with check ((id = auth.uid()));

-- POLITICA push_devices :: push_devices_insert_own
create policy "push_devices_insert_own" on public.push_devices for INSERT to authenticated
  with check ((auth.uid() = user_id));

-- POLITICA push_devices :: push_devices_select_own
create policy "push_devices_select_own" on public.push_devices for SELECT to authenticated
  using ((auth.uid() = user_id));

-- POLITICA push_devices :: push_devices_update_own
create policy "push_devices_update_own" on public.push_devices for UPDATE to authenticated
  using ((auth.uid() = user_id))
  with check ((auth.uid() = user_id));

-- POLITICA time_entries :: time_entries_insert_own
create policy "time_entries_insert_own" on public.time_entries for INSERT to authenticated
  with check (((user_id = auth.uid()) AND is_member_of_company(company_id)));

-- POLITICA time_entries :: time_entries_insert_self
create policy "time_entries_insert_self" on public.time_entries for INSERT to authenticated
  with check (((created_by = auth.uid()) AND (user_id = auth.uid()) AND is_company_member(company_id)));

-- POLITICA time_entries :: time_entries_select_own
create policy "time_entries_select_own" on public.time_entries for SELECT to authenticated
  using (((user_id = auth.uid()) AND is_member_of_company(company_id)));

-- POLITICA time_entries :: time_entries_select_own_or_hr_owner
create policy "time_entries_select_own_or_hr_owner" on public.time_entries for SELECT to authenticated
  using (((user_id = auth.uid()) OR is_company_hr_or_owner(company_id)));

-- POLITICA time_entries :: time_entries_update_checkout_only
create policy "time_entries_update_checkout_only" on public.time_entries for UPDATE to authenticated
  using (((user_id = auth.uid()) AND (check_out_at IS NULL) AND is_member_of_company(company_id)))
  with check (((user_id = auth.uid()) AND is_member_of_company(company_id)));

-- POLITICA time_entries :: time_entries_update_hr_owner
create policy "time_entries_update_hr_owner" on public.time_entries for UPDATE to authenticated
  using (is_company_hr_or_owner(company_id))
  with check (is_company_hr_or_owner(company_id));

-- POLITICA time_entries :: time_entries_update_self_close
create policy "time_entries_update_self_close" on public.time_entries for UPDATE to authenticated
  using (((user_id = auth.uid()) AND (status = 'open'::time_entry_status) AND (check_out_at IS NULL)))
  with check (((user_id = auth.uid()) AND (status = 'closed'::time_entry_status) AND (check_out_at IS NOT NULL)));

-- POLITICA time_entry_adjustments :: tea_insert_own_entry
create policy "tea_insert_own_entry" on public.time_entry_adjustments for INSERT to authenticated
  with check ((EXISTS ( SELECT 1
   FROM time_entries te
  WHERE ((te.id = time_entry_adjustments.time_entry_id) AND (te.user_id = auth.uid())))));

-- POLITICA time_entry_adjustments :: tea_select_own_entry
create policy "tea_select_own_entry" on public.time_entry_adjustments for SELECT to authenticated
  using ((EXISTS ( SELECT 1
   FROM time_entries te
  WHERE ((te.id = time_entry_adjustments.time_entry_id) AND (te.user_id = auth.uid())))));

-- POLITICA time_entry_logs :: time_entry_logs_insert_admin_only
create policy "time_entry_logs_insert_admin_only" on public.time_entry_logs for INSERT to authenticated
  with check (is_company_hr_or_owner(company_id));

-- POLITICA time_entry_logs :: time_entry_logs_select_own
create policy "time_entry_logs_select_own" on public.time_entry_logs for SELECT to authenticated
  using ((EXISTS ( SELECT 1
   FROM time_entries te
  WHERE ((te.id = time_entry_logs.time_entry_id) AND (te.user_id = auth.uid()) AND is_member_of_company(te.company_id)))));

-- POLITICA time_entry_logs :: time_logs_select_scoped
create policy "time_logs_select_scoped" on public.time_entry_logs for SELECT to authenticated
  using ((is_company_hr_or_owner(company_id) OR (EXISTS ( SELECT 1
   FROM time_entries te
  WHERE ((te.id = time_entry_logs.time_entry_id) AND (te.user_id = auth.uid())))) OR (EXISTS ( SELECT 1
   FROM time_entry_requests tr
  WHERE ((tr.id = time_entry_logs.request_id) AND (tr.requested_by = auth.uid()))))));

-- POLITICA time_entry_requests :: time_requests_insert_self
create policy "time_requests_insert_self" on public.time_entry_requests for INSERT to authenticated
  with check (((requested_by = auth.uid()) AND is_company_member(company_id) AND (EXISTS ( SELECT 1
   FROM time_entries te
  WHERE ((te.id = time_entry_requests.time_entry_id) AND (te.user_id = auth.uid()) AND (te.company_id = time_entry_requests.company_id))))));

-- POLITICA time_entry_requests :: time_requests_select_own_or_hr_owner
create policy "time_requests_select_own_or_hr_owner" on public.time_entry_requests for SELECT to authenticated
  using (((requested_by = auth.uid()) OR is_company_hr_or_owner(company_id)));

-- POLITICA time_entry_requests :: time_requests_update_hr_owner
create policy "time_requests_update_hr_owner" on public.time_entry_requests for UPDATE to authenticated
  using (is_company_hr_or_owner(company_id))
  with check (is_company_hr_or_owner(company_id));

-- POLITICA worker_absences :: worker_absences_delete_hr_owner
create policy "worker_absences_delete_hr_owner" on public.worker_absences for DELETE to authenticated
  using (is_company_hr_or_owner(company_id));

-- POLITICA worker_absences :: worker_absences_insert_hr_owner
create policy "worker_absences_insert_hr_owner" on public.worker_absences for INSERT to authenticated
  with check (is_company_hr_or_owner(company_id));

-- POLITICA worker_absences :: worker_absences_select_own_or_hr_owner
create policy "worker_absences_select_own_or_hr_owner" on public.worker_absences for SELECT to authenticated
  using (((user_id = auth.uid()) OR is_company_hr_or_owner(company_id)));

-- POLITICA worker_absences :: worker_absences_update_hr_owner
create policy "worker_absences_update_hr_owner" on public.worker_absences for UPDATE to authenticated
  using (is_company_hr_or_owner(company_id))
  with check (is_company_hr_or_owner(company_id));

-- POLITICA worker_requests :: worker_requests_insert_own
create policy "worker_requests_insert_own" on public.worker_requests for INSERT to authenticated
  with check ((auth.uid() = user_id));

-- POLITICA worker_requests :: worker_requests_select_admin
create policy "worker_requests_select_admin" on public.worker_requests for SELECT to authenticated
  using ((EXISTS ( SELECT 1
   FROM memberships m
  WHERE ((m.user_id = auth.uid()) AND (m.company_id = worker_requests.company_id) AND (m.role = ANY (ARRAY['admin'::membership_role, 'owner'::membership_role]))))));

-- POLITICA worker_requests :: worker_requests_select_own
create policy "worker_requests_select_own" on public.worker_requests for SELECT to authenticated
  using ((auth.uid() = user_id));

-- POLITICA worker_requests :: worker_requests_update_admin
create policy "worker_requests_update_admin" on public.worker_requests for UPDATE to authenticated
  using ((EXISTS ( SELECT 1
   FROM memberships m
  WHERE ((m.user_id = auth.uid()) AND (m.company_id = worker_requests.company_id) AND (m.role = ANY (ARRAY['admin'::membership_role, 'owner'::membership_role]))))))
  with check ((EXISTS ( SELECT 1
   FROM memberships m
  WHERE ((m.user_id = auth.uid()) AND (m.company_id = worker_requests.company_id) AND (m.role = ANY (ARRAY['admin'::membership_role, 'owner'::membership_role]))))));
  
