const Prescription = {
    currentPatient: null,
    currentPrescriptionId: null,
    currentPrescriptionStatus: null,
    orderItems: [], // A felületen lévő tételek

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

    // Beteg és legfrissebb igénylés betöltése
    loadPatientOrder: async function(patientId) {
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
            
            document.getElementById("patientInfo").innerText = `TAJ: ${patient.taj || '-'} | Születési dátum: ${birthDateStr}${ageStr} | Ágy: ${patient.room_bed || '-'}`;

            // 2. Mai napra vonatkozó igénylés lekérése
            const now = new Date();
            const localTodayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0).toISOString();

            const { data: prescriptions, error: prescErr } = await window.supabaseClient
                .from('prescriptions')
                .select('*, prescription_items(*, pupha_master(*))')
                .eq('patient_id', patientId)
                .gte('created_at', localTodayStart)
                .order('created_at', { ascending: false });

            const existingPrescription = (prescriptions && prescriptions.length > 0) ? prescriptions[0] : null;

            if (existingPrescription) {
                this.currentPrescriptionId = existingPrescription.id;
                this.currentPrescriptionStatus = existingPrescription.status;

                // Meglévő tételek betöltése a tömbbe
                this.orderItems = (existingPrescription.prescription_items || []).map(item => {
                    const pupha = item.pupha_master;
                    return {
                        id: item.id,
                        pupha_id: item.pupha_id,
                        brand_name: item.substituted_name || (pupha ? pupha.brand_name : 'Ismeretlen'),
                        active_ingredient: item.substituted_ingredient || (pupha ? pupha.active_ingredient : ''),
                        dose_morning: item.dose_morning || 0,
                        dose_noon: item.dose_noon || 0,
                        dose_evening: item.dose_evening || 0,
                        dose_night: item.dose_night || 0,
                        is_patient_brought: item.is_patient_brought || false
                    };
                });

                // Státusz ellenőrzés
                const st = existingPrescription.status;
                if (st === 'reviewed' || st === 'dispensed' || st === 'completed') {
                    // Zárolt állapot
                    this.lockForm();
                } else {
                    // Szerkeszthető módosítás
                    this.setEditMode();
                }

            } else {
                // Nincs mai igénylés -> Új igénylés mód
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
        this.enableInputs(true);
    },

    setEditMode: function() {
        const submitBtn = document.getElementById("submitBtn");
        if (submitBtn) {
            submitBtn.innerText = "✏️ Mai igénylés módosítása";
            submitBtn.disabled = false;
        }
        document.getElementById("lockBanner").style.display = "none";
        this.enableInputs(true);
    },

    lockForm: function() {
        const submitBtn = document.getElementById("submitBtn");
        if (submitBtn) {
            submitBtn.innerText = "🔒 A rendelés le van zárva";
            submitBtn.disabled = true;
        }
        document.getElementById("lockBanner").style.display = "block";
        document.getElementById("copyPrevBtn").disabled = true;
        document.getElementById("puphaSearchInput").disabled = true;
        this.enableInputs(false);
    },

    enableInputs: function(enabled) {
        const inputs = document.querySelectorAll("#prescriptionTableBody input");
        inputs.forEach(i => i.disabled = !enabled);
        const btns = document.querySelectorAll("#prescriptionTableBody button");
        btns.forEach(b => b.disabled = !enabled);
    },

    // PuPha Törzs Kereső
    searchPupha: async function(term) {
        const resultsDiv = document.getElementById("puphaSearchResults");
        if (!term || term.length < 3) {
            resultsDiv.style.display = "none";
            return;
        }

        try {
            const { data, error } = await window.supabaseClient
                .from('pupha_master')
                .select('*')
                .or(`brand_name.ilike.%${term}%,active_ingredient.ilike.%${term}%`)
                .limit(10);

            if (error || !data || data.length === 0) {
                resultsDiv.innerHTML = '<div class="dropdown-item" style="color:#64748b;">Nincs találat.</div>';
            } else {
                let html = '';
                data.forEach(item => {
                    html += `
                        <div class="dropdown-item" onclick="Prescription.addDrugFromSearch('${item.id}', '${item.brand_name.replace(/'/g, "\\'")}', '${(item.active_ingredient || '').replace(/'/g, "\\'")}')">
                            <strong style="color:#1e293b;">${item.brand_name}</strong>
                            <div class="sub-text">Hatóanyag: ${item.active_ingredient || '-'}</div>
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

    addDrugFromSearch: function(puphaId, brandName, activeIngredient) {
        document.getElementById("puphaSearchInput").value = '';
        document.getElementById("puphaSearchResults").style.display = "none";

        // Ellenőrizzük, szerepel-e már
        const exists = this.orderItems.some(item => item.pupha_id === puphaId);
        if (exists) {
            alert("Ez a gyógyszer már szerepel a listán!");
            return;
        }

        this.orderItems.push({
            pupha_id: puphaId,
            brand_name: brandName,
            active_ingredient: activeIngredient,
            dose_morning: 1,
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

    // Táblázat kirajzolása (3. és 4. pont javítása)
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
                        <div class="ingredient-badge">Hatóanyag: ${item.active_ingredient || '-'}</div>
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
                        <button class="remove-btn" ${isLocked ? 'disabled' : ''} onclick="Prescription.removeDrug(${idx})">🗑</button>
                    </td>
                </tr>
            `;
        });

        tbody.innerHTML = html;
    },

    // Előző jóváhagyott terápia másolása
    copyPreviousDay: async function() {
        if (!this.currentPatient) return;

        try {
            const { data: pastPrescriptions } = await window.supabaseClient
                .from('prescriptions')
                .select('*, prescription_items(*, pupha_master(*))')
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
                return {
                    pupha_id: item.pupha_id,
                    brand_name: item.substituted_name || (pupha ? pupha.brand_name : ''),
                    active_ingredient: item.substituted_ingredient || (pupha ? pupha.active_ingredient : ''),
                    dose_morning: item.dose_morning || 0,
                    dose_noon: item.dose_noon || 0,
                    dose_evening: item.dose_evening || 0,
                    dose_night: item.dose_night || 0,
                    is_patient_brought: item.is_patient_brought || false
                };
            });

            this.renderOrderTable();
            alert("Előző jóváhagyott terápia sikeresen bemásolva!");

        } catch (e) {
            console.error("Másolási hiba:", e);
        }
    },

    // 4. pont: Rendelés feladása vagy Módosítása (INSERT vs UPDATE)
    submitOrder: async function() {
        if (!this.currentPatient) return;
        if (this.orderItems.length === 0) {
            alert("Kérjük, adjon hozzá legalább egy gyógyszert a rendeléshez!");
            return;
        }

        try {
            const user = Auth.getCurrentUser();
            let prescriptionId = this.currentPrescriptionId;

            if (prescriptionId) {
                // 1. MEGLÉVŐ IGÉNYLÉS MÓDOSÍTÁSA (UPDATE)
                const { error: updateErr } = await window.supabaseClient
                    .from('prescriptions')
                    .update({
                        status: 'submitted',
                        updated_at: new Date()
                    })
                    .eq('id', prescriptionId);

                if (updateErr) throw updateErr;

                // Régi tételek törlése és újak beszúrása
                await window.supabaseClient
                    .from('prescription_items')
                    .delete()
                    .eq('prescription_id', prescriptionId);

            } else {
                // 2. ÚJ IGÉNYLÉS LÉTREHOZÁSA (INSERT)
                const barcode = 'DA-' + new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14);

                const { data: newPresc, error: insertErr } = await window.supabaseClient
                    .from('prescriptions')
                    .insert({
                        patient_id: this.currentPatient.id,
                        doctor_id: user ? user.id : null,
                        status: 'submitted',
                        barcode: barcode
                    })
                    .select()
                    .single();

                if (insertErr) throw insertErr;
                prescriptionId = newPresc.id;
            }

            // TÉTELEK BESZÚRÁSA
            const itemsToInsert = this.orderItems.map(item => ({
                prescription_id: prescriptionId,
                pupha_id: item.pupha_id || null,
                substituted_name: item.brand_name,
                substituted_ingredient: item.active_ingredient,
                dose_morning: item.dose_morning,
                dose_noon: item.dose_noon,
                dose_evening: item.dose_evening,
                dose_night: item.dose_night,
                is_patient_brought: item.is_patient_brought
            }));

            const { error: itemsErr } = await window.supabaseClient
                .from('prescription_items')
                .insert(itemsToInsert);

            if (itemsErr) throw itemsErr;

            alert("Gyógyszerigénylés sikeresen elküldve a Patikának!");
            window.location.replace("doctor-dashboard.html");

        } catch (e) {
            console.error("Hiba az igénylés mentésekor:", e);
            alert("Hiba történt a rendelés elküldése során: " + (e.message || e));
        }
    }
};
