DO $$
DECLARE
  v_org uuid := 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
  v_loc uuid := 'c3d4e5f6-a7b8-9012-cdef-123456789012';

  o_sarah uuid; o_james uuid; o_emily uuid; o_mark uuid;
  o_lisa uuid; o_ryan uuid; o_natasha uuid; o_david uuid;

  p_bella uuid; p_max uuid; p_cooper uuid; p_whiskers uuid;
  p_luna uuid; p_duke uuid; p_daisy uuid; p_rocky uuid;
  p_mochi uuid; p_tucker uuid; p_bear uuid; p_sasha uuid;
  p_biscuit uuid; p_oliver uuid;

  s_daycare_full uuid; s_daycare_half uuid;
  s_board_over uuid; s_board_lux uuid;
  s_groom_bath uuid; s_groom_full uuid;
  s_train_group uuid; s_train_priv uuid;
  s_walk_30 uuid; s_walk_60 uuid;
  s_nail uuid;

  g_jessica uuid; g_alex uuid; g_sam uuid;

  inv_id uuid;
BEGIN
  -- Demo data seed for the Happy Tails Pet Care fixture org. The
  -- organization + matching location rows were originally created
  -- via the Supabase admin UI / MCP on the live DB and never landed
  -- as schema migrations. On a fresh database (CI integration tests,
  -- a new local supabase start, a staging branch) those rows don't
  -- exist, so this seed's INSERTs fail FK on owners.organization_id.
  --
  -- Guard the entire block so it becomes a no-op when the parent org
  -- isn't present. The live DB has the org; this branch keeps running
  -- as before. Fresh DBs skip the seed entirely.
  IF NOT EXISTS (SELECT 1 FROM organizations WHERE id = v_org) THEN
    RAISE NOTICE 'Skipping Happy Tails demo seed — organization % not present on this DB', v_org;
    RETURN;
  END IF;

  -- OWNERS
  INSERT INTO owners (organization_id, first_name, last_name, email, phone, street_address, city, state_province, postal_code) VALUES
    (v_org,'Sarah','Mitchell','sarah.mitchell@example.com','+1-780-555-0142','1024 Whyte Ave','Edmonton','AB','T6E 1A1') RETURNING id INTO o_sarah;
  INSERT INTO owners (organization_id, first_name, last_name, email, phone, street_address, city, state_province, postal_code) VALUES
    (v_org,'James','Chen','james.chen@example.com','+1-403-555-0188','22 Kensington Rd NW','Calgary','AB','T2N 3P5') RETURNING id INTO o_james;
  INSERT INTO owners (organization_id, first_name, last_name, email, phone, street_address, city, state_province, postal_code) VALUES
    (v_org,'Emily','Rodriguez','emily.rodriguez@example.com','+1-780-555-0231','455 Jasper Ave','Edmonton','AB','T5J 1Y4') RETURNING id INTO o_emily;
  INSERT INTO owners (organization_id, first_name, last_name, email, phone, street_address, city, state_province, postal_code) VALUES
    (v_org,'Mark','Thompson','mark.thompson@example.com','+1-403-555-0314','78 17 Ave SW','Calgary','AB','T2S 0A8') RETURNING id INTO o_mark;
  INSERT INTO owners (organization_id, first_name, last_name, email, phone, street_address, city, state_province, postal_code) VALUES
    (v_org,'Lisa','Patel','lisa.patel@example.com','+1-780-555-0457','909 Saskatchewan Dr','Edmonton','AB','T6G 2A7') RETURNING id INTO o_lisa;
  INSERT INTO owners (organization_id, first_name, last_name, email, phone, street_address, city, state_province, postal_code) VALUES
    (v_org,'Ryan','O''Brien','ryan.obrien@example.com','+1-403-555-0512','312 Inglewood Dr SE','Calgary','AB','T2G 1B6') RETURNING id INTO o_ryan;
  INSERT INTO owners (organization_id, first_name, last_name, email, phone, street_address, city, state_province, postal_code) VALUES
    (v_org,'Natasha','Volkov','natasha.volkov@example.com','+1-780-555-0689','1500 109 St NW','Edmonton','AB','T6J 4M8') RETURNING id INTO o_natasha;
  INSERT INTO owners (organization_id, first_name, last_name, email, phone, street_address, city, state_province, postal_code) VALUES
    (v_org,'David','Kim','david.kim@example.com','+1-403-555-0734','4421 Macleod Tr S','Calgary','AB','T2G 0A5') RETURNING id INTO o_david;

  -- PETS
  INSERT INTO pets (organization_id, name, species, breed, sex, date_of_birth, weight_kg, spayed_neutered, intake_status) VALUES
    (v_org,'Bella','dog','Golden Retriever','F', (CURRENT_DATE - INTERVAL '4 years')::date, 29.5, true, 'approved') RETURNING id INTO p_bella;
  INSERT INTO pets (organization_id, name, species, breed, sex, date_of_birth, weight_kg, spayed_neutered, intake_status) VALUES
    (v_org,'Max','dog','French Bulldog','M', (CURRENT_DATE - INTERVAL '2 years')::date, 11.3, true, 'approved') RETURNING id INTO p_max;
  INSERT INTO pets (organization_id, name, species, breed, sex, date_of_birth, weight_kg, spayed_neutered, intake_status) VALUES
    (v_org,'Cooper','dog','Labrador Retriever','M', (CURRENT_DATE - INTERVAL '3 years')::date, 31.8, true, 'approved') RETURNING id INTO p_cooper;
  INSERT INTO pets (organization_id, name, species, breed, sex, date_of_birth, weight_kg, spayed_neutered, intake_status) VALUES
    (v_org,'Whiskers','cat','Domestic Shorthair','F', (CURRENT_DATE - INTERVAL '5 years')::date, 4.5, true, 'approved') RETURNING id INTO p_whiskers;
  INSERT INTO pets (organization_id, name, species, breed, sex, date_of_birth, weight_kg, spayed_neutered, intake_status) VALUES
    (v_org,'Luna','dog','Bernese Mountain Dog','F', (CURRENT_DATE - INTERVAL '1 years')::date, 38.6, false, 'approved') RETURNING id INTO p_luna;
  INSERT INTO pets (organization_id, name, species, breed, sex, date_of_birth, weight_kg, spayed_neutered, intake_status) VALUES
    (v_org,'Duke','dog','German Shepherd','M', (CURRENT_DATE - INTERVAL '6 years')::date, 36.3, true, 'approved') RETURNING id INTO p_duke;
  INSERT INTO pets (organization_id, name, species, breed, sex, date_of_birth, weight_kg, spayed_neutered, intake_status) VALUES
    (v_org,'Daisy','dog','Standard Poodle','F', (CURRENT_DATE - INTERVAL '3 years')::date, 20.4, true, 'approved') RETURNING id INTO p_daisy;
  INSERT INTO pets (organization_id, name, species, breed, sex, date_of_birth, weight_kg, spayed_neutered, intake_status) VALUES
    (v_org,'Rocky','dog','Boxer','M', (CURRENT_DATE - INTERVAL '4 years')::date, 29.5, true, 'approved') RETURNING id INTO p_rocky;
  INSERT INTO pets (organization_id, name, species, breed, sex, date_of_birth, weight_kg, spayed_neutered, intake_status) VALUES
    (v_org,'Mochi','cat','Ragdoll','F', (CURRENT_DATE - INTERVAL '2 years')::date, 5.4, true, 'approved') RETURNING id INTO p_mochi;
  INSERT INTO pets (organization_id, name, species, breed, sex, date_of_birth, weight_kg, spayed_neutered, intake_status) VALUES
    (v_org,'Tucker','dog','Australian Shepherd','M', (CURRENT_DATE - INTERVAL '2 years')::date, 25.0, true, 'approved') RETURNING id INTO p_tucker;
  INSERT INTO pets (organization_id, name, species, breed, sex, date_of_birth, weight_kg, spayed_neutered, intake_status) VALUES
    (v_org,'Bear','dog','Siberian Husky','M', (CURRENT_DATE - INTERVAL '5 years')::date, 27.2, true, 'approved') RETURNING id INTO p_bear;
  INSERT INTO pets (organization_id, name, species, breed, sex, date_of_birth, weight_kg, spayed_neutered, intake_status) VALUES
    (v_org,'Sasha','dog','Samoyed','F', (CURRENT_DATE - INTERVAL '3 years')::date, 22.7, true, 'approved') RETURNING id INTO p_sasha;
  INSERT INTO pets (organization_id, name, species, breed, sex, date_of_birth, weight_kg, spayed_neutered, intake_status) VALUES
    (v_org,'Biscuit','dog','Shiba Inu','M', (CURRENT_DATE - INTERVAL '4 years')::date, 10.0, true, 'approved') RETURNING id INTO p_biscuit;
  INSERT INTO pets (organization_id, name, species, breed, sex, date_of_birth, weight_kg, spayed_neutered, intake_status) VALUES
    (v_org,'Oliver','cat','British Shorthair','M', (CURRENT_DATE - INTERVAL '3 years')::date, 6.4, true, 'approved') RETURNING id INTO p_oliver;

  -- PET-OWNER LINKS
  INSERT INTO pet_owners (organization_id, pet_id, owner_id, relationship) VALUES
    (v_org,p_bella,o_sarah,'primary'),
    (v_org,p_max,o_sarah,'primary'),
    (v_org,p_cooper,o_james,'primary'),
    (v_org,p_whiskers,o_james,'primary'),
    (v_org,p_luna,o_emily,'primary'),
    (v_org,p_duke,o_mark,'primary'),
    (v_org,p_daisy,o_mark,'primary'),
    (v_org,p_rocky,o_mark,'primary'),
    (v_org,p_mochi,o_lisa,'primary'),
    (v_org,p_tucker,o_ryan,'primary'),
    (v_org,p_bear,o_ryan,'primary'),
    (v_org,p_sasha,o_natasha,'primary'),
    (v_org,p_biscuit,o_david,'primary'),
    (v_org,p_oliver,o_david,'primary');

  -- SERVICES
  INSERT INTO services (organization_id, location_id, module, name, duration_type, base_price_cents) VALUES
    (v_org,v_loc,'daycare','Daycare — Full Day','full_day',4500) RETURNING id INTO s_daycare_full;
  INSERT INTO services (organization_id, location_id, module, name, duration_type, base_price_cents) VALUES
    (v_org,v_loc,'daycare','Daycare — Half Day','half_day',3000) RETURNING id INTO s_daycare_half;
  INSERT INTO services (organization_id, location_id, module, name, duration_type, base_price_cents) VALUES
    (v_org,v_loc,'boarding','Boarding — Overnight','overnight',6500) RETURNING id INTO s_board_over;
  INSERT INTO services (organization_id, location_id, module, name, duration_type, base_price_cents) VALUES
    (v_org,v_loc,'boarding','Boarding — Luxury Suite','overnight',9500) RETURNING id INTO s_board_lux;
  INSERT INTO services (organization_id, location_id, module, name, duration_type, base_price_cents, duration_minutes) VALUES
    (v_org,v_loc,'grooming','Grooming — Bath & Brush','hourly',5500,60) RETURNING id INTO s_groom_bath;
  INSERT INTO services (organization_id, location_id, module, name, duration_type, base_price_cents, duration_minutes) VALUES
    (v_org,v_loc,'grooming','Grooming — Full Groom','hourly',8500,90) RETURNING id INTO s_groom_full;
  INSERT INTO services (organization_id, location_id, module, name, duration_type, base_price_cents, duration_minutes) VALUES
    (v_org,v_loc,'training','Training — Group Class','hourly',3500,60) RETURNING id INTO s_train_group;
  INSERT INTO services (organization_id, location_id, module, name, duration_type, base_price_cents, duration_minutes) VALUES
    (v_org,v_loc,'training','Training — Private','hourly',7500,60) RETURNING id INTO s_train_priv;
  INSERT INTO services (organization_id, location_id, module, name, duration_type, base_price_cents, duration_minutes) VALUES
    (v_org,v_loc,'daycare','Walking — 30 min','hourly',2000,30) RETURNING id INTO s_walk_30;
  INSERT INTO services (organization_id, location_id, module, name, duration_type, base_price_cents, duration_minutes) VALUES
    (v_org,v_loc,'daycare','Walking — 60 min','hourly',3500,60) RETURNING id INTO s_walk_60;
  INSERT INTO services (organization_id, location_id, module, name, duration_type, base_price_cents, duration_minutes) VALUES
    (v_org,v_loc,'grooming','Nail Trim','hourly',1500,15) RETURNING id INTO s_nail;

  -- GROOMERS
  INSERT INTO groomers (organization_id, display_name, specialties, working_days, max_appointments_per_day, commission_rate_percent, bio) VALUES
    (v_org,'Jessica Park', ARRAY['Full Groom','Doodle Cuts','Hand Stripping'], ARRAY['Monday','Tuesday','Wednesday','Thursday','Friday'], 8, 50, 'Certified master groomer with 10+ years experience.') RETURNING id INTO g_jessica;
  INSERT INTO groomers (organization_id, display_name, specialties, working_days, max_appointments_per_day, commission_rate_percent, bio) VALUES
    (v_org,'Alex Rivera', ARRAY['Bath & Brush','Large Breeds','De-shedding'], ARRAY['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'], 6, 45, 'Specializes in large and double-coated breeds.') RETURNING id INTO g_alex;
  INSERT INTO groomers (organization_id, display_name, specialties, working_days, max_appointments_per_day, commission_rate_percent, bio) VALUES
    (v_org,'Sam Wilson', ARRAY['Cat Grooming','Nail Art','Teeth Brushing'], ARRAY['Tuesday','Wednesday','Thursday','Friday','Saturday'], 7, 50, 'Cat-friendly and gentle handling certified.') RETURNING id INTO g_sam;

  -- PLAYGROUPS
  INSERT INTO playgroups (organization_id, location_id, name, description, capacity, color) VALUES
    (v_org,v_loc,'Small Dogs','Dogs under 25 lb',8,'#F2D3C9'),
    (v_org,v_loc,'Medium Dogs','Dogs 25–60 lb',10,'#EED4BB'),
    (v_org,v_loc,'Large Dogs','Dogs 60 lb and up',8,'#CBA48F');

  -- KENNEL RUNS
  INSERT INTO kennel_runs (organization_id, location_id, name, run_type, capacity, daily_rate_modifier_cents) VALUES
    (v_org,v_loc,'Standard Run 1','indoor',1,0),
    (v_org,v_loc,'Standard Run 2','indoor',1,0),
    (v_org,v_loc,'Standard Run 3','outdoor',1,0),
    (v_org,v_loc,'Standard Run 4','outdoor',1,0),
    (v_org,v_loc,'Luxury Suite A','large',2,2000),
    (v_org,v_loc,'Luxury Suite B','large',2,2000);

  -- SUITES
  INSERT INTO suites (organization_id, location_id, name, type, capacity, daily_rate_cents) VALUES
    (v_org,v_loc,'Standard Suite 1','standard',1,6500),
    (v_org,v_loc,'Standard Suite 2','standard',1,6500),
    (v_org,v_loc,'Premium Suite 1','deluxe',2,9500),
    (v_org,v_loc,'Premium Suite 2','deluxe',2,9500);

  -- RETAIL PRODUCTS
  INSERT INTO retail_products (organization_id, name, category, price_cents, cost_cents, stock_quantity, reorder_point) VALUES
    (v_org,'Premium Dog Food (15 lb)','food',6500,3800,24,6),
    (v_org,'Organic Cat Treats','treats',1200,500,40,10),
    (v_org,'Leather Collar','accessory',3500,1500,18,5),
    (v_org,'Plush Dog Bed','bedding',8900,4200,8,3),
    (v_org,'Dental Chew Pack','treats',1800,700,32,8);

  -- RESERVATIONS (12)
  WITH r AS (INSERT INTO reservations (organization_id, location_id, service_id, primary_owner_id, start_at, end_at, status, source)
    VALUES (v_org,v_loc,s_daycare_full,o_sarah, (CURRENT_DATE)::timestamp + TIME '08:00', (CURRENT_DATE)::timestamp + TIME '17:00','confirmed','staff_created') RETURNING id)
    INSERT INTO reservation_pets (organization_id, reservation_id, pet_id) SELECT v_org, id, p_bella FROM r;

  WITH r AS (INSERT INTO reservations (organization_id, location_id, service_id, primary_owner_id, start_at, end_at, status, source)
    VALUES (v_org,v_loc,s_daycare_half,o_lisa, (CURRENT_DATE)::timestamp + TIME '09:00', (CURRENT_DATE)::timestamp + TIME '13:00','confirmed','staff_created') RETURNING id)
    INSERT INTO reservation_pets (organization_id, reservation_id, pet_id) SELECT v_org, id, p_mochi FROM r;

  WITH r AS (INSERT INTO reservations (organization_id, location_id, service_id, primary_owner_id, start_at, end_at, status, source)
    VALUES (v_org,v_loc,s_board_over,o_natasha, (CURRENT_DATE + 1)::timestamp + TIME '10:00', (CURRENT_DATE + 3)::timestamp + TIME '11:00','confirmed','staff_created') RETURNING id)
    INSERT INTO reservation_pets (organization_id, reservation_id, pet_id) SELECT v_org, id, p_sasha FROM r;

  WITH r AS (INSERT INTO reservations (organization_id, location_id, service_id, primary_owner_id, start_at, end_at, status, source)
    VALUES (v_org,v_loc,s_board_lux,o_david, (CURRENT_DATE + 1)::timestamp + TIME '14:00', (CURRENT_DATE + 4)::timestamp + TIME '11:00','confirmed','staff_created') RETURNING id)
    INSERT INTO reservation_pets (organization_id, reservation_id, pet_id) SELECT v_org, id, p_biscuit FROM r;

  WITH r AS (INSERT INTO reservations (organization_id, location_id, service_id, primary_owner_id, start_at, end_at, status, source, checked_in_at)
    VALUES (v_org,v_loc,s_daycare_full,o_james, (CURRENT_DATE)::timestamp + TIME '07:30', (CURRENT_DATE)::timestamp + TIME '17:30','checked_in','staff_created', NOW() - INTERVAL '3 hours') RETURNING id)
    INSERT INTO reservation_pets (organization_id, reservation_id, pet_id) SELECT v_org, id, p_cooper FROM r;

  WITH r AS (INSERT INTO reservations (organization_id, location_id, service_id, primary_owner_id, start_at, end_at, status, source, checked_in_at)
    VALUES (v_org,v_loc,s_daycare_full,o_ryan, (CURRENT_DATE)::timestamp + TIME '08:00', (CURRENT_DATE)::timestamp + TIME '18:00','checked_in','staff_created', NOW() - INTERVAL '2 hours 30 minutes') RETURNING id)
    INSERT INTO reservation_pets (organization_id, reservation_id, pet_id) SELECT v_org, id, p_tucker FROM r;

  WITH r AS (INSERT INTO reservations (organization_id, location_id, service_id, primary_owner_id, start_at, end_at, status, source, checked_in_at)
    VALUES (v_org,v_loc,s_daycare_half,o_emily, (CURRENT_DATE)::timestamp + TIME '12:00', (CURRENT_DATE)::timestamp + TIME '17:00','checked_in','staff_created', NOW() - INTERVAL '1 hour') RETURNING id)
    INSERT INTO reservation_pets (organization_id, reservation_id, pet_id) SELECT v_org, id, p_luna FROM r;

  WITH r AS (INSERT INTO reservations (organization_id, location_id, service_id, primary_owner_id, start_at, end_at, status, source, checked_in_at, checked_out_at)
    VALUES (v_org,v_loc,s_daycare_full,o_mark, (CURRENT_DATE - 1)::timestamp + TIME '08:00', (CURRENT_DATE - 1)::timestamp + TIME '17:00','checked_out','staff_created', (CURRENT_DATE - 1)::timestamp + TIME '08:05', (CURRENT_DATE - 1)::timestamp + TIME '17:10') RETURNING id)
    INSERT INTO reservation_pets (organization_id, reservation_id, pet_id) SELECT v_org, id, p_duke FROM r;

  WITH r AS (INSERT INTO reservations (organization_id, location_id, service_id, primary_owner_id, start_at, end_at, status, source, checked_in_at, checked_out_at)
    VALUES (v_org,v_loc,s_board_over,o_sarah, (CURRENT_DATE - 2)::timestamp + TIME '15:00', (CURRENT_DATE - 1)::timestamp + TIME '11:00','checked_out','owner_self_serve', (CURRENT_DATE - 2)::timestamp + TIME '15:10', (CURRENT_DATE - 1)::timestamp + TIME '10:50') RETURNING id)
    INSERT INTO reservation_pets (organization_id, reservation_id, pet_id) SELECT v_org, id, p_max FROM r;

  WITH r AS (INSERT INTO reservations (organization_id, location_id, service_id, primary_owner_id, start_at, end_at, status, source)
    VALUES (v_org,v_loc,s_daycare_full,o_mark, (CURRENT_DATE + 4)::timestamp + TIME '08:00', (CURRENT_DATE + 4)::timestamp + TIME '17:00','confirmed','owner_self_serve') RETURNING id)
    INSERT INTO reservation_pets (organization_id, reservation_id, pet_id) SELECT v_org, id, p_daisy FROM r;

  WITH r AS (INSERT INTO reservations (organization_id, location_id, service_id, primary_owner_id, start_at, end_at, status, source)
    VALUES (v_org,v_loc,s_board_over,o_ryan, (CURRENT_DATE + 5)::timestamp + TIME '10:00', (CURRENT_DATE + 7)::timestamp + TIME '11:00','confirmed','owner_self_serve') RETURNING id)
    INSERT INTO reservation_pets (organization_id, reservation_id, pet_id) SELECT v_org, id, p_bear FROM r;

  WITH r AS (INSERT INTO reservations (organization_id, location_id, service_id, primary_owner_id, start_at, end_at, status, source, notes)
    VALUES (v_org,v_loc,s_daycare_full,o_mark, (CURRENT_DATE + 2)::timestamp + TIME '08:00', (CURRENT_DATE + 2)::timestamp + TIME '17:00','cancelled','owner_self_serve','Owner travel rescheduled') RETURNING id)
    INSERT INTO reservation_pets (organization_id, reservation_id, pet_id) SELECT v_org, id, p_rocky FROM r;

  -- GROOMING APPOINTMENTS (6)
  INSERT INTO grooming_appointments (organization_id, pet_id, owner_id, groomer_id, appointment_date, start_time, estimated_duration_minutes, services_requested, price_cents, status) VALUES
    (v_org, p_bella, o_sarah, g_jessica, CURRENT_DATE, TIME '10:00', 90, ARRAY['Full Groom'], 8500, 'scheduled'),
    (v_org, p_daisy, o_mark, g_jessica, CURRENT_DATE, TIME '13:30', 90, ARRAY['Full Groom','Doodle Cut'], 8500, 'scheduled');

  INSERT INTO grooming_appointments (organization_id, pet_id, owner_id, groomer_id, appointment_date, start_time, estimated_duration_minutes, services_requested, price_cents, status, check_in_time) VALUES
    (v_org, p_sasha, o_natasha, g_alex, CURRENT_DATE, TIME '09:00', 120, ARRAY['Bath & Brush','De-shedding'], 7500, 'in_progress', NOW() - INTERVAL '40 minutes');

  INSERT INTO grooming_appointments (organization_id, pet_id, owner_id, groomer_id, appointment_date, start_time, estimated_duration_minutes, services_requested, price_cents, status, check_in_time, completed_time) VALUES
    (v_org, p_oliver, o_david, g_sam, CURRENT_DATE - 1, TIME '11:00', 60, ARRAY['Cat Grooming','Nail Trim'], 6500, 'completed', (CURRENT_DATE - 1)::timestamp + TIME '11:05', (CURRENT_DATE - 1)::timestamp + TIME '12:00'),
    (v_org, p_duke, o_mark, g_alex, CURRENT_DATE - 1, TIME '14:00', 90, ARRAY['Bath & Brush','Large Breeds'], 7000, 'completed', (CURRENT_DATE - 1)::timestamp + TIME '14:00', (CURRENT_DATE - 1)::timestamp + TIME '15:30');

  INSERT INTO grooming_appointments (organization_id, pet_id, owner_id, groomer_id, appointment_date, start_time, estimated_duration_minutes, services_requested, price_cents, status) VALUES
    (v_org, p_mochi, o_lisa, g_sam, CURRENT_DATE + 1, TIME '10:30', 60, ARRAY['Cat Grooming'], 6500, 'scheduled');

  -- INVOICES (8): 5 paid, 2 sent, 1 draft
  INSERT INTO invoices (organization_id, location_id, owner_id, status, subtotal_cents, tax_cents, total_cents, amount_paid_cents, currency, issued_at, paid_at)
    VALUES (v_org, v_loc, o_sarah, 'paid', 4500, 225, 4725, 4725, 'CAD', NOW() - INTERVAL '6 days', NOW() - INTERVAL '6 days') RETURNING id INTO inv_id;
  INSERT INTO invoice_lines (organization_id, invoice_id, service_id, description, quantity, unit_price_cents, line_total_cents)
    VALUES (v_org, inv_id, s_daycare_full, 'Daycare — Full Day (Bella)', 1, 4500, 4500);

  INSERT INTO invoices (organization_id, location_id, owner_id, status, subtotal_cents, tax_cents, total_cents, amount_paid_cents, currency, issued_at, paid_at)
    VALUES (v_org, v_loc, o_mark, 'paid', 13000, 650, 13650, 13650, 'CAD', NOW() - INTERVAL '5 days', NOW() - INTERVAL '5 days') RETURNING id INTO inv_id;
  INSERT INTO invoice_lines (organization_id, invoice_id, service_id, description, quantity, unit_price_cents, line_total_cents)
    VALUES (v_org, inv_id, s_board_over, 'Boarding — Overnight (Duke) x2', 2, 6500, 13000);

  INSERT INTO invoices (organization_id, location_id, owner_id, status, subtotal_cents, tax_cents, total_cents, amount_paid_cents, currency, issued_at, paid_at)
    VALUES (v_org, v_loc, o_david, 'paid', 8500, 425, 8925, 8925, 'CAD', NOW() - INTERVAL '4 days', NOW() - INTERVAL '4 days') RETURNING id INTO inv_id;
  INSERT INTO invoice_lines (organization_id, invoice_id, service_id, description, quantity, unit_price_cents, line_total_cents)
    VALUES (v_org, inv_id, s_groom_full, 'Grooming — Full Groom (Biscuit)', 1, 8500, 8500);

  INSERT INTO invoices (organization_id, location_id, owner_id, status, subtotal_cents, tax_cents, total_cents, amount_paid_cents, currency, issued_at, paid_at)
    VALUES (v_org, v_loc, o_lisa, 'paid', 3000, 150, 3150, 3150, 'CAD', NOW() - INTERVAL '3 days', NOW() - INTERVAL '3 days') RETURNING id INTO inv_id;
  INSERT INTO invoice_lines (organization_id, invoice_id, service_id, description, quantity, unit_price_cents, line_total_cents)
    VALUES (v_org, inv_id, s_daycare_half, 'Daycare — Half Day (Mochi)', 1, 3000, 3000);

  INSERT INTO invoices (organization_id, location_id, owner_id, status, subtotal_cents, tax_cents, total_cents, amount_paid_cents, currency, issued_at, paid_at)
    VALUES (v_org, v_loc, o_ryan, 'paid', 19400, 970, 20370, 20370, 'CAD', NOW() - INTERVAL '1 day', NOW() - INTERVAL '1 day') RETURNING id INTO inv_id;
  INSERT INTO invoice_lines (organization_id, invoice_id, service_id, description, quantity, unit_price_cents, line_total_cents) VALUES
    (v_org, inv_id, s_daycare_full, 'Daycare — Full Day (Tucker)', 1, 4500, 4500),
    (v_org, inv_id, s_daycare_full, 'Daycare — Full Day (Bear)', 1, 4500, 4500),
    (v_org, inv_id, NULL, 'Premium Dog Food (15 lb)', 1, 6500, 6500),
    (v_org, inv_id, NULL, 'Dental Chew Pack', 2, 1800, 3600),
    (v_org, inv_id, NULL, 'Leather Collar (discounted)', 1, 300, 300);

  INSERT INTO invoices (organization_id, location_id, owner_id, status, subtotal_cents, tax_cents, total_cents, amount_paid_cents, currency, issued_at, due_at)
    VALUES (v_org, v_loc, o_emily, 'sent', 4500, 225, 4725, 0, 'CAD', NOW() - INTERVAL '2 days', NOW() + INTERVAL '5 days') RETURNING id INTO inv_id;
  INSERT INTO invoice_lines (organization_id, invoice_id, service_id, description, quantity, unit_price_cents, line_total_cents)
    VALUES (v_org, inv_id, s_daycare_full, 'Daycare — Full Day (Luna)', 1, 4500, 4500);

  INSERT INTO invoices (organization_id, location_id, owner_id, status, subtotal_cents, tax_cents, total_cents, amount_paid_cents, currency, issued_at, due_at)
    VALUES (v_org, v_loc, o_natasha, 'sent', 13000, 650, 13650, 0, 'CAD', NOW(), NOW() + INTERVAL '7 days') RETURNING id INTO inv_id;
  INSERT INTO invoice_lines (organization_id, invoice_id, service_id, description, quantity, unit_price_cents, line_total_cents)
    VALUES (v_org, inv_id, s_board_over, 'Boarding — Overnight (Sasha) x2', 2, 6500, 13000);

  INSERT INTO invoices (organization_id, location_id, owner_id, status, subtotal_cents, tax_cents, total_cents, amount_paid_cents, currency, issued_at)
    VALUES (v_org, v_loc, o_james, 'draft', 7700, 385, 8085, 0, 'CAD', NOW()) RETURNING id INTO inv_id;
  INSERT INTO invoice_lines (organization_id, invoice_id, service_id, description, quantity, unit_price_cents, line_total_cents) VALUES
    (v_org, inv_id, s_groom_bath, 'Grooming — Bath & Brush (Cooper)', 1, 5500, 5500),
    (v_org, inv_id, s_nail, 'Nail Trim (Whiskers)', 1, 1500, 1500),
    (v_org, inv_id, NULL, 'Organic Cat Treats', 1, 1200, 1200);

END $$;