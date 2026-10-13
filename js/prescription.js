window.Prescription = {
    currentPatient: null,
    currentPrescriptionId: null,
    currentPrescriptionStatus: null,
    targetDate: null, // YYYY-MM-DD
    orderItems: [],

    // Életkor kiszámítása
    calculateAge: function(birthDateStr) {
        if (!birthDateStr) return null;
        const bDate = new Date(birthDateStr);
        if (isNaN(bDate)) return null;
        const today = new Date();
        let age = today.getFullYear() - bDate.getFullYear();
        const m = today.getMonth() - bDate.getMonth();
        if (m < 0 || (m === 0 && today.getDate() < bDate.getDate())) age--;
        return age;
    },

    // Beteg és kiválasztott dátumra vonatkozó igénylés betöltése
    loadPatientOrder: async function(patientId, dateStr = null) {
        this.targetDate = dateStr || new Date().toISOString().substring(0, 10);

        try {
            // 1. Beteg adatainak betöltése
            const { data: patient, error: patErr } = await window.supabaseClient
                .from('patients')
                .select('*')
                .eq('id', patientId)
                .single();

            if (patErr || !patient) {
                alert("Hiba a beteg adatai betöltésekor!");
                return;
            }

            this.currentPatient = patient;
            document.getElementById("patientName").innerText = patient.name;
            
            const birthDateStr = patient.birth_date ? new Date(patient.birth_date).toLocaleDateString('hu-HU') : '-';
            const age = this.calculateAge(patient.birth_date);
            const ageStr = age !== null ? ` (${age} év)` : '';
            
            document.getElementById("patientInfo").innerText = `TAJ: ${patient.taj || '-'} | Születési dátum: ${birthDateStr}${ageStr} | Ágy: ${patient.room_bed || '-'} | Dátum: ${this.targetDate}`;

            // 2. Igénylés lekérése KIFEJEZETTEN a megadott napra (targetDate)
            const startOfDay = `${this.targetDate}T00:00:00.000Z`;
            const endOfDay = `${this.targetDate}T23:59:59.999Z`;

            const { data: prescriptions, error: prescErr } = await window.supabaseClient
                .from('prescriptions')
                .select('*, prescription_items(*, pupha_master:pupha_drug_id(*), local_inventory_master:local_drug_id(*))')
                .eq('patient_id', patientId)
                .gte('created_at', startOfDay)
                .lte('created_at', endOfDay)
                .order('created_at', { ascending: false })
                .limit(1);

            const existingPrescription = (prescriptions && prescriptions.length > 0) ? prescriptions[0] : null;

            if (existingPrescription) {
                this.currentPrescriptionId = existingPrescription.id;
                this.currentPrescriptionStatus = existingPrescription.status;

                // Tételek betöltése
                this.orderItems = (existingPrescription.prescription_items || []).map(item => {
                    const pupha = item.pupha_master;
                    const local = item.local_inventory_master;
                    
                    const displayName = item.substituted_name || (local ? local.brand_name : (pupha ? pupha.brand_name : 'Gyógyszer'));
                    const displayIngredient = item.substituted_ingredient || (local ? local.active_ingredient : (pupha ? pupha.active_ingredient : ''));

                    return {
                        id: item.id,
                        pupha_id: item.pupha_drug_id,
                        local_id: item.local_drug_id,
                        brand_name: displayName,
                        active_ingredient: displayIngredient,
                        dose_morning: item.dose_morning || 0,
                        dose_noon: item.dose_noon || 0,
                        dose_evening: item.dose_evening || 0,
                        dose_night: item.dose_night || 0,
                        is_patient_brought: item.is_patient_brought || item.is_own_medication || false
                    };
                });

                // Státusz ellenőrzés
                const st = existingPrescription.status;
                if (st === 'reviewed' || st === 'dispensed' || st === 'completed') {
                    this.lockForm();
                } else {
                    this.setEditMode();
                }

            } else {
                // Nincs igénylés erre a napra -> Új igénylés mód
                this.currentPrescriptionId = null;
                this.currentPrescriptionStatus = null;
                this.orderItems = [];
                this.setCreateMode();
            }

            this.renderOrderTable();

        } catch (e) {
            console.error("Hiba az igénylés betöltésekor:", e);
        }
    },

    setCreateMode: function() {
        const submitBtn = document.getElementById("submitBtn");
        if (submitBtn) {
            submitBtn.innerText = "🚀 Gyógyszerigénylés feladása a Patikának";
            submitBtn.disabled = false;
        }
        document.getElementById("lockBanner").style.display = "none";
        document.getElementById("copyPrevBtn").disabled = false;
        document.getElementById("puphaSearchInput").disabled = false;
        this.enableInputs(true);
    },

    setEditMode: function() {
        const submitBtn = document.getElementById("submitBtn");
        if (submitBtn) {
            submitBtn.innerText = "✏️ Mai igénylés módosítása";
            submitBtn.disabled = false;
        }
        document.getElementById("lockBanner").style.display = "none";
        document.getElementById("copyPrevBtn").disabled = false;
        document.getElementById("puphaSearchInput").disabled = false;
        this.enableInputs(true);
    },

    lockForm: function() {
        const submitBtn = document.getElementById("submitBtn");
        if (submitBtn) {
            submitBtn.innerText = "🔒 A rendelés le van zárva (Patikában feldolgozva)";
            submitBtn.disabled = true;
        }
        document.getElementById("lockBanner").style.display = "block";
        document.getElementById("copyPrevBtn").disabled = true;
        document.getElementById("puphaSearchInput").disabled = true;
        this.enableInputs(false);
    },

    enableInputs: function(enabled) {
        setTimeout(() => {
            const inputs = document.querySelectorAll("#prescriptionTableBody input");
            inputs.forEach(i => i.disabled = !enabled);
            const btns = document.querySelectorAll("#prescriptionTableBody button");
            btns.forEach(b => b.disabled = !enabled);
        }, 50);
    },

    // KETTŐS GYÓGYSZERKERESŐ (LOCAL INVENTORY + PUPHA MASTER)
    searchDrugs: async function(term) {
        const resultsDiv = document.getElementById("puphaSearchResults");
        if (!term || term.length < 2) {
            resultsDiv.style.display = "none";
            return;
        }

        try {
            // A) Keresés Helyi Készletben
            const { data: localData } = await window.supabaseClient
                .from('local_inventory_master')
                .select('*')
                .eq('is_active', true)
                .or(`brand_name.ilike.%${term}%,active_ingredient.ilike.%${term}%`)
                .limit(8);

            // B) Keresés PuPha Törzsben
            const { data: puphaData } = await window.supabaseClient
                .from('pupha_master')
                .select('*')
                .or(`brand_name.ilike.%${term}%,active_ingredient.ilike.%${term}%`)
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
            } else {
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
            }
            resultsDiv.style.display = "block";

        } catch (e) {
            console.error("Keresési hiba:", e);
        }
    },

    addDrugFromSearch: function(type, id, brandName, activeIngredient) {
        document.getElementById("puphaSearchInput").value = '';
        document.getElementById("puphaSearchResults").style.display = "none";

        const exists = this.orderItems.some(item => 
            (type === 'local' && item.local_id === id) || 
            (type === 'pupha' && item.pupha_id === id) ||
            (item.brand_name.toLowerCase() === brandName.toLowerCase())
        );

        if (exists) {
            alert("Ez a gyógyszer már szerepel a listán!");
            return;
        }

        this.orderItems.push({
            pupha_id: type === 'pupha' ? id : null,
            local_id: type === 'local' ? id : null,
            brand_name: brandName,
            active_ingredient: activeIngredient,
            dose_morning: 0,
            dose_noon: 0,
            dose_evening: 0,
            dose_night: 0,
            is_patient_brought: false
        });

        this.renderOrderTable();
    },

    removeDrug: function(index) {
        if (this.currentPrescriptionStatus && ['reviewed', 'dispensed', 'completed'].includes(this.currentPrescriptionStatus)) return;
        this.orderItems.splice(index, 1);
        this.renderOrderTable();
    },

    updateDose: function(index, field, value) {
        const val = parseFloat(value) || 0;
        if (this.orderItems[index]) {
            this.orderItems[index][field] = val;
        }
    },

    togglePatientBrought: function(index, checked) {
        if (this.orderItems[index]) {
            this.orderItems[index].is_patient_brought = checked;
        }
    },

    // Táblázat kirajzolása
    renderOrderTable: function() {
        const tbody = document.getElementById("prescriptionTableBody");
        if (!this.orderItems || this.orderItems.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color:#64748b; padding:20px;">Még nincs gyógyszer hozzáadva. Használja a fenti keresőt!</td></tr>';
            return;
        }

        const isLocked = ['reviewed', 'dispensed', 'completed'].includes(this.currentPrescriptionStatus);

        let html = '';
        this.orderItems.forEach((item, idx) => {
            html += `
                <tr>
                    <td>
                        <div class="drug-title">${item.brand_name}</div>
                        <div class="ingredient-badge">${item.active_ingredient || '-'}</div>
                    </td>
                    <td style="text-align:center;">
                        <input type="number" min="0" step="0.5" value="${item.dose_morning}" ${isLocked ? 'disabled' : ''} onchange="Prescription.updateDose(${idx}, 'dose_morning', this.value)">
                    </td>
                    <td style="text-align:center;">
                        <input type="number" min="0" step="0.5" value="${item.dose_noon}" ${isLocked ? 'disabled' : ''} onchange="Prescription.updateDose(${idx}, 'dose_noon', this.value)">
                    </td>
                    <td style="text-align:center;">
                        <input type="number" min="0" step="0.5" value="${item.dose_evening}" ${isLocked ? 'disabled' : ''} onchange="Prescription.updateDose(${idx}, 'dose_evening', this.value)">
                    </td>
                    <td style="text-align:center;">
                        <input type="number" min="0" step="0.5" value="${item.dose_night}" ${isLocked ? 'disabled' : ''} onchange="Prescription.updateDose(${idx}, 'dose_night', this.value)">
                    </td>
                    <td style="text-align:center;">
                        <input type="checkbox" ${item.is_patient_brought ? 'checked' : ''} ${isLocked ? 'disabled' : ''} onchange="Prescription.togglePatientBrought(${idx}, this.checked)">
                    </td>
                    <td style="text-align:center;">
                        <button class="remove-btn" ${isLocked ? 'disabled' : ''} onclick="Prescription.removeDrug(${idx})">❌</button>
                    </td>
                </tr>
            `;
        });

        tbody.innerHTML = html;
        if (isLocked) {
            this.enableInputs(false);
        }
    },

    // Előző jóváhagyott terápia másolása
    copyPreviousDay: async function() {
        if (!this.currentPatient) return;

        try {
            const { data: pastPrescriptions } = await window.supabaseClient
                .from('prescriptions')
                .select('*, prescription_items(*, pupha_master:pupha_drug_id(*), local_inventory_master:local_drug_id(*))')
                .eq('patient_id', this.currentPatient.id)
                .in('status', ['reviewed', 'dispensed', 'completed'])
                .order('created_at', { ascending: false })
                .limit(1);

            if (!pastPrescriptions || pastPrescriptions.length === 0) {
                alert("Nincs korábbi jóváhagyott terápia ehhez a beteghez!");
                return;
            }

            const pastItems = pastPrescriptions[0].prescription_items || [];
            this.orderItems = pastItems.map(item => {
                const pupha = item.pupha_master;
                const local = item.local_inventory_master;
                return {
                    pupha_id: item.pupha_drug_id,
                    local_id: item.local_drug_id,
                    brand_name: item.substituted_name || (local ? local.brand_name : (pupha ? pupha.brand_name : '')),
                    active_ingredient: item.substituted_ingredient || (local ? local.active_ingredient : (pupha ? pupha.active_ingredient : '')),
                    dose_morning: item.dose_morning || 0,
                    dose_noon: item.dose_noon || 0,
                    dose_evening: item.dose_evening || 0,
                    dose_night: item.dose_night || 0,
                    is_patient_brought: item.is_patient_brought || item.is_own_medication || false
                };
            });

            this.renderOrderTable();
            alert("Előző jóváhagyott terápia sikeresen bemásolva!");

        } catch (e) {
            console.error("Másolási hiba:", e);
        }
    },

    // Rendelés feladása vagy Módosítása
    submitOrder: async function() {
        if (!this.currentPatient) return;
        if (this.orderItems.length === 0) {
            alert("Kérjük, adjon hozzá legalább egy gyógyszert a rendeléshez!");
            return;
        }

        // Ha le van zárolva, elutasítjuk a beküldést
        if (['reviewed', 'dispensed', 'completed'].includes(this.currentPrescriptionStatus)) {
            alert("Ez az igénylés a patikában már fel lett dolgozva, nem módosítható!");
            return;
        }

        try {
            const user = Auth.getCurrentUser();
            let prescriptionId = this.currentPrescriptionId;

            // Pontos dátum-idő az adott napra
            const now = new Date();
            const timePart = now.toTimeString().split(' ')[0];
            const fullIsoDate = `${this.targetDate}T${timePart}.000Z`;

            if (prescriptionId) {
                // 1. MEGLÉVŐ IGÉNYLÉS MÓDOSÍTÁSA (UPDATE)
                const { error: updateErr } = await window.supabaseClient
                    .from('prescriptions')
                    .update({ 
                        status: 'submitted',
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
                // 2. ÚJ IGÉNYLÉS LÉTREHOZÁSA (INSERT)
                const cleanDate = this.targetDate.replace(/-/g, '');
                const barcode = `DA-${cleanDate}-${Math.floor(1000 + Math.random() * 9000)}`;

                const insertData = {
                    patient_id: this.currentPatient.id,
                    status: 'submitted',
                    barcode: barcode,
                    created_at: fullIsoDate
                };

                if (user && user.id) {
                    insertData.prescribed_by = user.id;
                }

                const { data: newPresc, error: insertErr } = await window.supabaseClient
                    .from('prescriptions')
                    .insert(insertData)
                    .select()
                    .single();

                if (insertErr) throw insertErr;
                prescriptionId = newPresc.id;
            }

            // TÉTELEK BESZÚRÁSA (created_at nélkül)
            const itemsToInsert = this.orderItems.map(item => ({
                prescription_id: prescriptionId,
                pupha_drug_id: item.pupha_id || null,
                local_drug_id: item.local_id || null,
                substituted_name: item.brand_name,
                substituted_ingredient: item.active_ingredient,
                dose_morning: item.dose_morning || 0,
                dose_noon: item.dose_noon || 0,
                dose_evening: item.dose_evening || 0,
                dose_night: item.dose_night || 0,
                is_patient_brought: !!item.is_patient_brought
            }));

            const { error: itemsErr } = await window.supabaseClient
                .from('prescription_items')
                .insert(itemsToInsert);

            if (itemsErr) throw itemsErr;

            alert("Gyógyszerigénylés sikeresen elküldve a Patikának!");
            window.location.replace("doctor-dashboard.html");

        } catch (e) {
            console.error("Hiba az igénylés mentésekor:", e);
            alert("Hiba történt a rendelés elküldése során: " + (e.message || JSON.stringify(e)));
        }
    }
};
