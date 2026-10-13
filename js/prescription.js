window.Prescription = {
    currentPatient: null,
    currentPrescription: null,
    targetDate: null, // YYYY-MM-DD
    items: [],
    isLocked: false,

    // 1. BETEG ÉS DÁTUM SPECIFIKUS IGÉNYLÉS BETÖLTÉSE
    async loadPatientOrder(patientId, dateStr = null) {
        this.targetDate = dateStr || new Date().toISOString().substring(0, 10);

        try {
            // A beteg adatainak lekérése
            const { data: patient, error: pErr } = await window.supabaseClient
                .from('patients')
                .select('*')
                .eq('id', patientId)
                .single();

            if (pErr || !patient) {
                alert("Beteg nem található!");
                return;
            }

            this.currentPatient = patient;
            this.renderPatientHeader();

            // Kifejezetten a targetDate napra keressük az igénylést
            const startOfDay = `${this.targetDate}T00:00:00.000Z`;
            const endOfDay = `${this.targetDate}T23:59:59.999Z`;

            const { data: prescriptions, error: prescErr } = await window.supabaseClient
                .from('prescriptions')
                .select('*, prescription_items(*, pupha_master(*), local_inventory_master(*))')
                .eq('patient_id', patientId)
                .gte('created_at', startOfDay)
                .lte('created_at', endOfDay)
                .order('created_at', { ascending: false });

            if (!prescErr && prescriptions && prescriptions.length > 0) {
                this.currentPrescription = prescriptions[0];
                
                // Zárolás ellenőrzése: Csak akkor zárolunk, ha a KIVÁLASZTOTT NAPRA vonatkozó igénylés státusza már nem draft/pending
                const status = this.currentPrescription.status;
                if (status === 'reviewed' || status === 'dispensed' || status === 'completed') {
                    this.isLocked = true;
                } else {
                    this.isLocked = false;
                }

                // Tételek betöltése
                this.items = (this.currentPrescription.prescription_items || []).map(item => {
                    const local = item.local_inventory_master;
                    const pupha = item.pupha_master;

                    return {
                        id: item.id,
                        local_id: item.local_id || (local ? local.id : null),
                        pupha_id: item.pupha_id || (pupha ? pupha.id : null),
                        brand_name: local ? local.brand_name : (pupha ? pupha.brand_name : (item.substituted_name || 'Gyógyszer')),
                        active_ingredient: local ? local.active_ingredient : (pupha ? pupha.active_ingredient : '-'),
                        dose_morning: item.dose_morning || 0,
                        dose_noon: item.dose_noon || 0,
                        dose_evening: item.dose_evening || 0,
                        dose_night: item.dose_night || 0,
                        is_patient_brought: item.is_patient_brought || false
                    };
                });
            } else {
                // Ha a kiválasztott napra még nincs igénylés -> friss, szerkeszthető felület
                this.currentPrescription = null;
                this.items = [];
                this.isLocked = false;
            }

            this.applyLockState();
            this.renderTable();

        } catch (err) {
            console.error("Hiba a rendelés betöltésekor:", err);
        }
    },

    renderPatientHeader() {
        if (!this.currentPatient) return;
        const p = this.currentPatient;
        
        const bDate = p.birth_date ? new Date(p.birth_date).toLocaleDateString('hu-HU') : '-';
        document.getElementById("patientName").innerText = p.name;
        document.getElementById("patientInfo").innerText = `Osztály: ${p.department || '-'} | Ágy: ${p.room_bed || '-'} | TAJ: ${p.taj || '-'} | Szül: ${bDate} | Dátum: ${this.targetDate}`;
    },

    applyLockState() {
        const banner = document.getElementById("lockBanner");
        const submitBtn = document.getElementById("submitBtn");
        const searchInput = document.getElementById("puphaSearchInput");
        const copyBtn = document.getElementById("copyPrevBtn");

        if (this.isLocked) {
            banner.style.display = "block";
            if (submitBtn) submitBtn.disabled = true;
            if (searchInput) searchInput.disabled = true;
            if (copyBtn) copyBtn.disabled = true;
        } else {
            banner.style.display = "none";
            if (submitBtn) submitBtn.disabled = false;
            if (searchInput) searchInput.disabled = false;
            if (copyBtn) copyBtn.disabled = false;
        }
    },

    // 2. KETTŐS GYÓGYSZERKERESÉS (LOCAL INVENTORY + PUPHA MASTER)
    async searchDrugs(query) {
        const resultsDiv = document.getElementById("puphaSearchResults");
        if (!query || query.length < 2) {
            resultsDiv.style.display = "none";
            return;
        }

        try {
            // A) Keresés a Helyi Készletben
            const { data: localData } = await window.supabaseClient
                .from('local_inventory_master')
                .select('*')
                .eq('is_active', true)
                .or(`brand_name.ilike.%${query}%,active_ingredient.ilike.%${query}%`)
                .limit(8);

            // B) Keresés a PuPha Törzsben
            const { data: puphaData } = await window.supabaseClient
                .from('pupha_master')
                .select('*')
                .or(`brand_name.ilike.%${query}%,active_ingredient.ilike.%${query}%`)
                .limit(8);

            let combinedResults = [];

            if (localData) {
                localData.forEach(item => {
                    combinedResults.push({
                        type: 'local',
                        id: item.id,
                        brand_name: item.brand_name,
                        active_ingredient: item.active_ingredient || '',
                        pharmaceutical_form: item.pharmaceutical_form || ''
                    });
                });
            }

            if (puphaData) {
                puphaData.forEach(item => {
                    const exists = combinedResults.some(r => r.brand_name.toLowerCase() === item.brand_name.toLowerCase());
                    if (!exists) {
                        combinedResults.push({
                            type: 'pupha',
                            id: item.id,
                            brand_name: item.brand_name,
                            active_ingredient: item.active_ingredient || '',
                            pharmaceutical_form: item.pharmaceutical_form || ''
                        });
                    }
                });
            }

            if (combinedResults.length === 0) {
                resultsDiv.innerHTML = '<div class="dropdown-item" style="color:#64748b;">Nincs találat.</div>';
                resultsDiv.style.display = "block";
                return;
            }

            let html = '';
            combinedResults.forEach(item => {
                const badge = item.type === 'local' 
                    ? '<span style="background:#e8f5e9; color:#2e7d32; font-size:10px; font-weight:bold; padding:2px 6px; border-radius:4px; margin-left:6px;">🏥 Kórházi készlet</span>' 
                    : '<span style="background:#e3f2fd; color:#1565c0; font-size:10px; font-weight:bold; padding:2px 6px; border-radius:4px; margin-left:6px;">💊 PuPha törzs</span>';

                html += `
                    <div class="dropdown-item" onclick="Prescription.addDrugFromSearch('${item.type}', '${item.id}', '${item.brand_name.replace(/'/g, "\\'")}', '${(item.active_ingredient || '').replace(/'/g, "\\'")}')">
                        <strong style="color:#1e293b;">${item.brand_name}</strong> ${badge}
                        <div class="sub-text">${item.active_ingredient} ${item.pharmaceutical_form ? '| ' + item.pharmaceutical_form : ''}</div>
                    </div>
                `;
            });

            resultsDiv.innerHTML = html;
            resultsDiv.style.display = "block";

        } catch (e) {
            console.error("Gyógyszer keresési hiba:", e);
        }
    },

    addDrugFromSearch(type, id, brandName, ingredient) {
        document.getElementById("puphaSearchResults").style.display = "none";
        document.getElementById("puphaSearchInput").value = "";

        const exists = this.items.some(it => 
            (type === 'local' && it.local_id === id) || 
            (type === 'pupha' && it.pupha_id === id) ||
            (it.brand_name.toLowerCase() === brandName.toLowerCase())
        );

        if (exists) {
            alert("Ez a gyógyszer már szerepel a listán!");
            return;
        }

        this.items.push({
            id: null,
            local_id: type === 'local' ? id : null,
            pupha_id: type === 'pupha' ? id : null,
            brand_name: brandName,
            active_ingredient: ingredient,
            dose_morning: 1,
            dose_noon: 0,
            dose_evening: 0,
            dose_night: 0,
            is_patient_brought: false
        });

        this.renderTable();
    },

    renderTable() {
        const tbody = document.getElementById("prescriptionTableBody");
        if (!this.items || this.items.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color:#64748b; padding:20px;">Nincsenek tételek hozzáadva. Használja a fenti keresőt!</td></tr>';
            return;
        }

        let html = '';
        this.items.forEach((item, idx) => {
            html += `
                <tr>
                    <td>
                        <div class="drug-title">${item.brand_name}</div>
                        <div class="ingredient-badge">${item.active_ingredient}</div>
                    </td>
                    <td style="text-align:center;"><input type="number" min="0" step="0.5" value="${item.dose_morning}" ${this.isLocked ? 'disabled' : ''} onchange="Prescription.updateDose(${idx}, 'dose_morning', this.value)"></td>
                    <td style="text-align:center;"><input type="number" min="0" step="0.5" value="${item.dose_noon}" ${this.isLocked ? 'disabled' : ''} onchange="Prescription.updateDose(${idx}, 'dose_noon', this.value)"></td>
                    <td style="text-align:center;"><input type="number" min="0" step="0.5" value="${item.dose_evening}" ${this.isLocked ? 'disabled' : ''} onchange="Prescription.updateDose(${idx}, 'dose_evening', this.value)"></td>
                    <td style="text-align:center;"><input type="number" min="0" step="0.5" value="${item.dose_night}" ${this.isLocked ? 'disabled' : ''} onchange="Prescription.updateDose(${idx}, 'dose_night', this.value)"></td>
                    <td style="text-align:center;"><input type="checkbox" ${item.is_patient_brought ? 'checked' : ''} ${this.isLocked ? 'disabled' : ''} onchange="Prescription.updateDose(${idx}, 'is_patient_brought', this.checked)"></td>
                    <td style="text-align:center;">
                        <button class="remove-btn" ${this.isLocked ? 'disabled' : ''} onclick="Prescription.removeItem(${idx})">❌</button>
                    </td>
                </tr>
            `;
        });

        tbody.innerHTML = html;
    },

    updateDose(index, field, value) {
        if (this.isLocked) return;
        if (field === 'is_patient_brought') {
            this.items[index][field] = value;
        } else {
            this.items[index][field] = parseFloat(value) || 0;
        }
    },

    removeItem(index) {
        if (this.isLocked) return;
        this.items.splice(index, 1);
        this.renderTable();
    },

    // 3. ELŐZŐ JÓVÁHAGYOTT TERÁPIA MÁSOLÁSA
    async copyPreviousDay() {
        if (this.isLocked) return;

        try {
            const { data: prevPrescs, error } = await window.supabaseClient
                .from('prescriptions')
                .select('*, prescription_items(*, pupha_master(*), local_inventory_master(*))')
                .eq('patient_id', this.currentPatient.id)
                .in('status', ['reviewed', 'dispensed', 'completed'])
                .order('created_at', { ascending: false })
                .limit(1);

            if (error || !prevPrescs || prevPrescs.length === 0) {
                alert("Nincs korábbi jóváhagyott terápia ehhez a beteghez!");
                return;
            }

            const prevItems = prevPrescs[0].prescription_items || [];
            
            this.items = prevItems.map(item => {
                const local = item.local_inventory_master;
                const pupha = item.pupha_master;

                return {
                    id: null,
                    local_id: item.local_id || (local ? local.id : null),
                    pupha_id: item.pupha_id || (pupha ? pupha.id : null),
                    brand_name: local ? local.brand_name : (pupha ? pupha.brand_name : (item.substituted_name || 'Gyógyszer')),
                    active_ingredient: local ? local.active_ingredient : (pupha ? pupha.active_ingredient : '-'),
                    dose_morning: item.dose_morning || 0,
                    dose_noon: item.dose_noon || 0,
                    dose_evening: item.dose_evening || 0,
                    dose_night: item.dose_night || 0,
                    is_patient_brought: item.is_patient_brought || false
                };
            });

            this.renderTable();
            alert("Korábbi sikeres terápia tételei bemásolva!");

        } catch (e) {
            console.error("Hiba a másoláskor:", e);
        }
    },

    // 4. IGÉNYLÉS FELADÁSA A PATIKÁNAK
    async submitOrder() {
        if (this.isLocked) return;
        if (!this.items || this.items.length === 0) {
            alert("Kérjük, adjon hozzá legalább egy gyógyszert!");
            return;
        }

        try {
            // Dátum és idő pontos felépítése
            const now = new Date();
            const timePart = now.toTimeString().split(' ')[0]; // HH:mm:ss
            const fullIsoDate = `${this.targetDate}T${timePart}.000Z`;

            let prescriptionId = this.currentPrescription ? this.currentPrescription.id : null;

            if (prescriptionId) {
                // Meglévő (draft/pending) igénylés frissítése
                const { error: updateErr } = await window.supabaseClient
                    .from('prescriptions')
                    .update({
                        status: 'pending',
                        updated_at: new Date().toISOString()
                    })
                    .eq('id', prescriptionId);

                if (updateErr) throw updateErr;

                // Régi tételek törlése
                const { error: delErr } = await window.supabaseClient
                    .from('prescription_items')
                    .delete()
                    .eq('prescription_id', prescriptionId);

                if (delErr) throw delErr;

            } else {
                // Új igénylés beszúrása az adott napra
                const cleanDate = this.targetDate.replace(/-/g, '');
                const generatedBarcode = `DA-${cleanDate}-${Math.floor(1000 + Math.random() * 9000)}`;

                const insertData = {
                    patient_id: this.currentPatient.id,
                    status: 'pending',
                    barcode: generatedBarcode,
                    created_at: fullIsoDate
                };

                const { data: newPresc, error: createErr } = await window.supabaseClient
                    .from('prescriptions')
                    .insert(insertData)
                    .select()
                    .single();

                if (createErr) throw createErr;
                prescriptionId = newPresc.id;
            }

            // Tételek beszúrása a prescription_items táblába
            const itemsToInsert = this.items.map(it => {
                const row = {
                    prescription_id: prescriptionId,
                    dose_morning: it.dose_morning || 0,
                    dose_noon: it.dose_noon || 0,
                    dose_evening: it.dose_evening || 0,
                    dose_night: it.dose_night || 0,
                    is_patient_brought: it.is_patient_brought || false,
                    created_at: fullIsoDate
                };

                if (it.local_id) row.local_id = it.local_id;
                if (it.pupha_id) row.pupha_id = it.pupha_id;

                return row;
            });

            const { error: itemsErr } = await window.supabaseClient
                .from('prescription_items')
                .insert(itemsToInsert);

            if (itemsErr) throw itemsErr;

            alert("Gyógyszerigénylés sikeresen feladva a Patikának!");
            window.location.replace("doctor-dashboard.html");

        } catch (e) {
            console.error("Részletes hiba a mentéskor:", e);
            alert(`Hiba történt az igénylés feladása során: ${e.message || JSON.stringify(e)}`);
        }
    }
};
