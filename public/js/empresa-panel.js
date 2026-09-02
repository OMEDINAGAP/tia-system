const token = sessionStorage.getItem('gestionEmpresaToken');

if (!token) location.replace('/');

const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
}[char]));

function goRequirements() {
  location.href = '/empresa-requisitos.html';
}

function logout() {
  sessionStorage.clear();
  location.replace('/');
}

function openModal() {
  document.getElementById('modal').classList.add('open');
}

function closeModal() {
  document.getElementById('modal').classList.remove('open');
  document.getElementById('personForm').reset();
}

function progressMarkup(progress) {
  const value = Math.max(0, Math.min(100, Math.round(Number(progress) || 0)));
  return `<div class="progress-track"><div class="progress-fill" style="width:${value}%"></div></div><small>${value}% completado</small>`;
}

function statusMarkup(person) {
  if (person.suspendido_en) return '<span class="suspended">Acceso suspendido</span>';
  if (!person.aprobado) return progressMarkup(person.progreso);
  if (person.foto_estatus === 'APROBADA') return '<span class="complete">Curso concluido</span>';
  if (person.foto_estatus === 'PENDIENTE') return '<span style="color:#fbbf24;font-weight:bold">Fotografía en revisión</span>';
  if (person.foto_estatus === 'RECHAZADA') return '<span style="color:#f87171;font-weight:bold">Fotografía rechazada</span>';
  return '<span style="color:#fbbf24;font-weight:bold">Fotografía pendiente</span>';
}

function certificateMarkup(person) {
  if (person.suspendido_en) return '<small>No disponible</small>';
  if (person.aprobado && person.foto_estatus === 'APROBADA') {
    return `<button class="download" onclick="downloadCertificate(${Number(person.id)},'${esc(person.folio)}')">Descargar PDF</button>`;
  }
  if (person.aprobado && person.foto_estatus === 'PENDIENTE') return '<small>Pendiente de validación</small>';
  if (person.aprobado && person.foto_estatus === 'RECHAZADA') return '<small>Debe tomar una nueva foto</small>';
  return '<small>No disponible</small>';
}

function actionMarkup(person) {
  if (person.suspendido_en) return '<small class="suspended">Suspendido</small>';
  const name = [person.nombres, person.apellido_paterno, person.apellido_materno].filter(Boolean).join(' ');
  return `<button class="danger" onclick="suspendAccess(${Number(person.id)}, ${esc(JSON.stringify(name))})">Suspender acceso</button>`;
}

async function loadPeople() {
  try {
    const response = await fetch('/empresa-personas', { headers: { Authorization: 'Bearer ' + token } });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.message || 'Sesión expirada');

    document.getElementById('empresa').textContent = data.empresa;
    document.getElementById('empty').style.display = data.personas.length ? 'none' : 'block';
    document.getElementById('rows').innerHTML = data.personas.map(person => `
      <tr>
        <td class="folio">${esc(person.folio)}</td>
        <td>${esc([person.nombres, person.apellido_paterno, person.apellido_materno].filter(Boolean).join(' '))}</td>
        <td>${esc(person.puesto)}</td>
        <td>${esc(person.telefono)}</td>
        <td>${esc(person.correo)}</td>
        <td>${statusMarkup(person)}</td>
        <td>${certificateMarkup(person)}</td>
        <td>${actionMarkup(person)}</td>
      </tr>`).join('');
  } catch (error) {
    sessionStorage.clear();
    await Swal.fire('Sesión expirada', error.message || 'Ingresa nuevamente', 'warning');
    location.replace('/');
  }
}

async function suspendAccess(id, name) {
  const confirmation = await Swal.fire({
    icon: 'warning',
    title: '¿Suspender acceso al sistema?',
    html: `<p>Se inhabilitará de inmediato el acceso de <strong>${esc(name)}</strong> al sistema TIA.</p><p><strong>Esto no es una baja formal.</strong> Para concluirla, la empresa debe acudir al módulo TIA en sitio y entregar el documento de baja junto con la TIA.</p>`,
    showCancelButton: true,
    confirmButtonText: 'Sí, suspender acceso',
    cancelButtonText: 'Cancelar',
    confirmButtonColor: '#b91c1c'
  });
  if (!confirmation.isConfirmed) return;

  const response = await fetch(`/empresa-personas/${id}/suspender`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) return Swal.fire('No fue posible suspender', data.message || 'Intenta nuevamente', 'error');
  await Swal.fire({
    icon: data.emailSent ? 'success' : 'warning',
    title: 'Acceso suspendido',
    html: data.emailSent
      ? 'El perfil quedó inhabilitado y se notificó a la empresa. La baja formal debe concluirse en el módulo TIA en sitio.'
      : `El perfil quedó inhabilitado. La baja formal debe concluirse en el módulo TIA en sitio.<br><small>${esc(data.warning || '')}</small>`
  });
  loadPeople();
}

async function downloadCertificate(id, folio) {
  const response = await fetch(`/empresa-personas/${id}/constancia`, { headers: { Authorization: 'Bearer ' + token } });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    return Swal.fire('Error', data.message || 'No fue posible descargar', 'error');
  }
  const url = URL.createObjectURL(await response.blob());
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `constancia-${folio}.pdf`;
  anchor.click();
  URL.revokeObjectURL(url);
}

document.getElementById('personForm').addEventListener('submit', async event => {
  event.preventDefault();
  const payload = Object.fromEntries(new FormData(event.currentTarget));
  const response = await fetch('/registro-persona', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify(payload)
  });
  const data = await response.json();
  if (!response.ok || !data.ok) return Swal.fire('Error', data.message || 'No fue posible registrar', 'error');
  closeModal();
  await Swal.fire({
    icon: 'success',
    title: 'Persona registrada',
    html: `Su folio personal es:<br><b style="font-size:22px">${esc(data.folio)}</b><br><small>Entregue este folio a la persona para ingresar al curso.</small>`
  });
  loadPeople();
});

loadPeople();
