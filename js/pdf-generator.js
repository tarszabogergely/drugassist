/**
 * DrugAssist - Osztályos Gyógyszerelési Összesítő PDF Generáló Modul
 */

async function generateDepartmentPdf(departmentName, targetDate) {
    const selectedDate = targetDate || window.selectedDate || new Date();
    const dateStr = selectedDate.toLocaleDateString('hu-HU', { year: 'numeric', month: 'long', day: 'numeric' });

    try {
        // 1. ADATOK LEKÉRDEZÉSE A SUPABASE-BŐL A KIVÁLASZTOTT NAPRA ÉS OSZTÁLYRA
        const startOfDay = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate(), 0, 0, 0).toISOString();
        const endOfDay = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate(), 23, 59, 59, 999).toISOString();

        // Betegek lekérése az adott osztályról
        const { data: patients, error: pErr } = await window.supabaseClient
            .from('patients')
            .select('*')
            .eq('department', departmentName)
            .order('room_bed', { ascending: true });

        if (pErr || !patients || patients.length === 0) {
            alert(`Nincs aktív beteg a(z) "${departmentName}" osztályon erre a napra.`);
            return;
        }

        const patientIds = patients.map(p => p.id);

        // Igénylések és tételek lekérése a felelős személyekkel
        const { data: prescriptions, error: prErr } = await window.supabaseClient
            .from('prescriptions')
            .select(`
                *,
                prescribed_profile:profiles!prescribed_by(full_name, email),
                reviewed_profile:profiles!reviewed_by(full_name, email),
                dispensed_profile:profiles!dispensed_by(full_name, email),
                verified_profile:profiles!verified_by(full_name, email),
                prescription_items(*, pupha_master:pupha_drug_id(*), local_inventory_master:local_drug_id(*))
            `)
            .in('patient_id', patientIds)
            .gte('created_at', startOfDay)
            .lte('created_at', endOfDay);

        if (prErr) {
            console.error("PDF Adatlekérdezési hiba:", prErr);
        }

        const prescMap = {};
        if (prescriptions) {
            prescriptions.forEach(p => {
                prescMap[p.patient_id] = p;
            });
        }

        // 2. NYOMTATÁSI HTML DOKUMENTUM FELÉPÍTÉSE
        let printContent = `
        <!DOCTYPE html>
        <html lang="hu">
        <head>
        <meta charset="UTF-8">
        <title>Osztályos Gyógyszerelési Összesítő - ${departmentName}</title>
        <style>
            @page { size: A4 portrait; margin: 10mm; }
            body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 10pt; color: #1e293b; margin: 0; padding: 0; }
            
            .header-table { width: 100%; border-collapse: collapse; margin-bottom: 12px; border-bottom: 2px solid #1565c0; padding-bottom: 6px; }
            .header-title { font-size: 18pt; font-weight: bold; color: #1565c0; margin: 0; }
            .header-subtitle { font-size: 10pt; font-weight: 600; color: #475569; margin-top: 2px; }
            .header-meta { text-align: right; font-size: 9.5pt; color: #334155; vertical-align: bottom; }
            
            .patient-box { border: 1px solid #cbd5e1; border-radius: 8px; padding: 10px 12px; margin-bottom: 12px; page-break-inside: avoid; background: #fff; }
            .patient-header { font-size: 11.5pt; font-weight: bold; color: #0f172a; margin-bottom: 2px; display: flex; justify-content: space-between; }
            .patient-sub { font-size: 9pt; color: #475569; margin-bottom: 6px; }
            
            .audit-trail { font-size: 8.5pt; color: #334155; background: #f8fafc; border: 1px solid #e2e8f0; padding: 6px 10px; border-radius: 6px; margin-bottom: 8px; display: grid; grid-template-columns: repeat(2, 1fr); gap: 3px; }
            .audit-item strong { color: #0f172a; }

            .drug-table { width: 100%; border-collapse: collapse; font-size: 8.5pt; margin-top: 4px; }
            .drug-table th { background: #f1f5f9; border: 1px solid #cbd5e1; padding: 5px 6px; text-align: center; font-weight: bold; color: #334155; }
            .drug-table th.left { text-align: left; }
            .drug-table td { border: 1px solid #e2e8f0; padding: 5px 6px; vertical-align: middle; }
            .drug-table td.center { text-align: center; }
            .drug-name { font-weight: bold; color: #0f172a; font-size: 9pt; }
            .drug-sub { font-size: 8pt; color: #64748b; }

            .signatures-container { margin-top: 35px; page-break-inside: avoid; }
            .signatures-table { width: 100%; border-collapse: collapse; margin-top: 15px; }
            .signatures-table td { width: 33.33%; text-align: center; vertical-align: bottom; height: 50px; }
            .signature-line { border-top: 1.5px solid #475569; width: 75%; margin: 0 auto 4px auto; }
            .signature-title { font-size: 9.5pt; font-weight: bold; color: #334155; }
        </style>
        </head>
        <body>

        <!-- DOKUMENTUM FEJLÉC (KÓRHÁZI ÉS INTÉZMÉNYI CSÉLE) -->
        <table class="header-table">
            <tr>
                <td>
                    <div class="header-title">DrugAssist</div>
                    <div class="header-subtitle">Markusovszky Egyetemi Oktatókórház, Szombathely</div>
                </td>
                <td class="header-meta">
                    <strong>Osztály:</strong> ${departmentName}<br>
                    <strong>Dátum:</strong> ${dateStr}
                </td>
            </tr>
        </table>
        `;

        // BETEGEK ÉS GYÓGYSZEREK CIKLUSA
        patients.forEach(patient => {
            const birthStr = patient.birth_date ? new Date(patient.birth_date).toLocaleDateString('hu-HU') : '-';
            const presc = prescMap[patient.id];

            // Személyek nevei az audit trailhez
            const prescribedBy = presc?.prescribed_profile?.full_name || presc?.prescribed_profile?.email || 'Dr. Tarszabó Gergely';
            const reviewedBy = presc?.reviewed_profile?.full_name || presc?.reviewed_profile?.email || 'Dr. Tarszabó Gergely';
            const dispensedBy = presc?.dispensed_profile?.full_name || presc?.dispensed_profile?.email || 'Gyógyszertári Asszisztens';
            const verifiedBy = presc?.verified_profile?.full_name || presc?.verified_profile?.email || 'Dr. Tarszabó Gergely';

            const items = presc?.prescription_items || [];

            printContent += `
            <div class="patient-box">
                <div class="patient-header">
                    <span>${patient.name}</span>
                    <span>Ágyszám: ${patient.room_bed || '-'}</span>
                </div>
                <div class="patient-sub">
                    <strong>TAJ:</strong> ${patient.taj || '-'} | <strong>Születési dátum:</strong> ${birthStr}
                </div>

                <!-- AUDIT TRAIL -->
                <div class="audit-trail">
                    <div class="audit-item"><strong>Gyógyszerelés azonosító:</strong> ${presc?.barcode || 'Nincs generálva'}</div>
                    <div class="audit-item"><strong>Igénylést feladta:</strong> ${prescribedBy}</div>
                    <div class="audit-item"><strong>Jóváhagyta (Patika):</strong> ${reviewedBy}</div>
                    <div class="audit-item"><strong>Gyógyszerelést készítette:</strong> ${dispensedBy}</div>
                    <div class="audit-item" style="grid-column: span 2;"><strong>Gyógyszerészeti ellenőrzést végezte:</strong> ${verifiedBy}</div>
                </div>

                <!-- GYÓGYSZERTÁBLÁZAT -->
                <table class="drug-table">
                    <thead>
                        <tr>
                            <th class="left" style="width: 35%;">Gyógyszernév / Hatóanyag</th>
                            <th style="width: 7%;">Reggel</th>
                            <th style="width: 7%;">Dél</th>
                            <th style="width: 7%;">Délután</th>
                            <th style="width: 7%;">Este</th>
                            <th style="width: 15%;">Gyári szám (LOT)</th>
                            <th style="width: 10%;">Lejárat</th>
                            <th class="left" style="width: 12%;">Morfológia</th>
                        </tr>
                    </thead>
                    <tbody>
            `;

            if (items.length === 0) {
                printContent += `
                    <tr>
                        <td colspan="8" class="center" style="color: #64748b; padding: 8px;">Ezen a napon nincs elrendelt gyógyszer.</td>
                    </tr>
                `;
            } else {
                items.forEach(item => {
                    const pupha = item.pupha_master;
                    const local = item.local_inventory_master;

                    const drugName = item.substituted_name || (local ? local.brand_name : (pupha ? pupha.brand_name : 'Gyógyszer'));
                    const ingredient = item.substituted_ingredient || (local ? local.active_ingredient : (pupha ? pupha.active_ingredient : ''));
                    const morphology = (local ? local.morphology : null) || (pupha ? pupha.morphology : null) || '-';

                    printContent += `
                        <tr>
                            <td>
                                <div class="drug-name">${drugName}</div>
                                ${ingredient ? `<div class="drug-sub">Hatóanyag: ${ingredient}</div>` : ''}
                            </td>
                            <td class="center"><strong>${item.dose_morning || 0}</strong></td>
                            <td class="center"><strong>${item.dose_noon || 0}</strong></td>
                            <td class="center"><strong>${item.dose_afternoon || 0}</strong></td>
                            <td class="center"><strong>${item.dose_evening || 0}</strong></td>
                            <td class="center">${item.batch_number || '-'}</td>
                            <td class="center">${item.expiration_date || '-'}</td>
                            <td>${morphology}</td>
                        </tr>
                    `;
                });
            }

            printContent += `
                    </tbody>
                </table>
            </div>
            `;
        });

        // ALÁÍRÁSI SÁV
        printContent += `
            <div class="signatures-container">
                <table class="signatures-table">
                    <tr>
                        <td>
                            <div class="signature-line"></div>
                            <div class="signature-title">Átadta</div>
                        </td>
                        <td>
                            <div class="signature-line"></div>
                            <div class="signature-title">Átvette</div>
                        </td>
                        <td>
                            <div class="signature-line"></div>
                            <div class="signature-title">Ellenőrizte</div>
                        </td>
                    </tr>
                </table>
            </div>

        </body>
        </html>
        `;

        // 3. MEGNYITÁS ÉS AUTOMATIKUS NYOMTATÁSI ABLAK
        const printWindow = window.open('', '_blank');
        printWindow.document.write(printContent);
        printWindow.document.close();
        printWindow.focus();
        setTimeout(() => {
            printWindow.print();
        }, 400);

    } catch (err) {
        console.error("Hiba a PDF generálásakor:", err);
        alert("Hiba történt a PDF dokumentum összeállítása során.");
    }
}
