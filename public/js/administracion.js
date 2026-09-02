const token=sessionStorage.getItem('token');if(!token||!token.startsWith('admin-'))location.replace('/admin-login.html');let data={companies:[],people:[],stats:{}},activeView='dashboard',visible=[];
const esc=v=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));const date=v=>v?new Date(v).toLocaleDateString('es-MX'):'--';
async function load(){const r=await fetch('/admin-overview',{headers:{Authorization:'Bearer '+token}});if(!r.ok){sessionStorage.clear();location.replace('/admin-login.html');return}data=await r.json();renderStats();fillCompanies();render()}
function renderStats(){const s=data.stats;document.getElementById('sCompanies').textContent=s.empresas;document.getElementById('sActive').textContent=s.empresasActivas;document.getElementById('sPeople').textContent=s.colaboradores;document.getElementById('sPassed').textContent=s.aprobados;document.getElementById('sFailed').textContent=s.reprobados;document.getElementById('sProgress').textContent=s.progresoPromedio+'%';document.getElementById('summaryRows').innerHTML=data.companies.map(c=>`<tr><td>${esc(c.nombre||c.empresa_autorizada)}</td><td>${badge(c.estatus)}</td><td>${c.colaboradores}</td><td>${c.aprobados||0}</td><td>${bar(c.progreso_promedio)}</td></tr>`).join('')}
function fillCompanies(){const names=[...new Set(data.people.map(p=>p.empresa).filter(Boolean))].sort();document.querySelectorAll('.person-company').forEach(s=>s.innerHTML='<option value="">Todas las empresas</option>'+names.map(n=>`<option>${esc(n)}</option>`).join(''))}
function badge(v){const cls=v==='USADO'||v==='APROBADO'?'green':v==='VENCIDO'||v==='SUSPENDIDO'||v==='REPROBADO'?'red':v==='CONFIGURANDO'?'yellow':'blue',label=v==='USADO'?'PERFIL ACTIVADO':v==='ACTIVO'?'PENDIENTE DE ACTIVACION':v;return `<span class="badge ${cls}">${esc(label||'PENDIENTE')}</span>`}function bar(v){v=Math.max(0,Math.min(100,Math.round(Number(v)||0)));return `<div class="progress"><i style="width:${v}%"></i></div><small>${v}%</small>`}
function companyFilter(){const q=document.getElementById('companySearch').value.toLowerCase(),st=document.getElementById('companyStatus').value,from=document.getElementById('companyFrom').value,to=document.getElementById('companyTo').value,cp=document.getElementById('companyPeople').value;return data.companies.filter(c=>{const hay=[c.folio,c.nombre,c.razon_social,c.empresa_autorizada,c.representante_legal].join(' ').toLowerCase();const d=(c.creado_en||c.fecha_emision||'').slice(0,10);return(!q||hay.includes(q))&&(!st||c.estatus===st)&&(!from||d>=from)&&(!to||d<=to)&&(!cp||(cp==='with'?c.colaboradores>0:c.colaboradores==0))})}
function personFilter(failed=false){const root=document.getElementById(failed?'failedToolbar':'peopleToolbar'),q=root.querySelector('.person-search').value.toLowerCase(),co=root.querySelector('.person-company').value,pr=root.querySelector('.person-progress').value,from=root.querySelector('.person-from').value,to=root.querySelector('.person-to').value;return data.people.filter(p=>{if(failed&&!(!p.aprobado&&Number(p.intentos)>0))return false;const hay=[p.folio,p.nombres,p.apellido_paterno,p.apellido_materno,p.correo,p.puesto,p.empresa].join(' ').toLowerCase(),n=Number(p.progreso||0),d=(p.creado_en||'').slice(0,10);let pok=!pr;if(pr==='0-25')pok=n<=25;if(pr==='26-50')pok=n>25&&n<=50;if(pr==='51-95')pok=n>50&&n<=95;if(pr==='96-100')pok=n>95;return(!q||hay.includes(q))&&(!co||p.empresa===co)&&pok&&(!from||d>=from)&&(!to||d<=to)})}
function render(){if(activeView==='companies'){visible=companyFilter();document.getElementById('companyRows').innerHTML=visible.map(c=>`<tr><td>${esc(c.folio)}</td><td><b>${esc(c.nombre||c.empresa_autorizada)}</b><br><small>${esc(c.razon_social||'Sin registro')}</small></td><td>${esc(c.representante_legal||'--')}</td><td>${esc(c.telefono_1||'--')}<br><small>${esc(c.correo_1||'')}</small></td><td>${badge(c.estatus)}</td><td>${date(c.caducidad)}</td><td>${c.colaboradores}</td><td>${bar(c.progreso_promedio)}</td><td><button class="view-btn" onclick="openCompany(${c.id})">Ver</button></td></tr>`).join('')}else if(activeView==='people'||activeView==='failed'){const failed=activeView==='failed';visible=personFilter(failed);document.getElementById(failed?'failedRows':'peopleRows').innerHTML=visible.map(p=>failed?`<tr><td>${esc(p.folio)}</td><td>${full(p)}</td><td>${esc(p.empresa)}</td><td>${esc(p.correo)}</td><td>${p.calificacion}%</td><td>${p.intentos}</td><td>${bar(p.progreso)}</td><td>${badge('REPROBADO')}</td></tr>`:`<tr><td>${esc(p.folio)}</td><td>${full(p)}</td><td>${esc(p.empresa)}</td><td>${esc(p.puesto)}<br><small>${esc(p.correo)}</small></td><td>${bar(p.progreso)}</td><td>${p.calificacion}%</td><td>${p.intentos}</td><td>${badge(p.aprobado?'APROBADO':p.estatus)}</td><td>${p.aprobado?`<button class="download" onclick="certificate(${p.id},'${esc(p.folio)}')">PDF</button>`:'--'}</td></tr>`).join('')}else visible=data.companies}

function openCompany(id){const c=data.companies.find(x=>Number(x.id)===Number(id));if(!c)return;document.getElementById('modalCompanyName').textContent=c.nombre||c.empresa_autorizada;document.getElementById('modalCompanyStatus').innerHTML=badge(c.estatus);const details=[['Folio empresarial',c.folio],['Razon social',c.razon_social],['Representante legal',c.representante_legal],['Usuario de cuenta',c.usuario],['Telefono principal',c.telefono_1],['Telefono alterno',c.telefono_2],['Correo principal',c.correo_1],['Correo alterno',c.correo_2],['Direccion',c.direccion],['Caducidad',date(c.caducidad)],['Fecha de activacion',date(c.creado_en)],['Actividad de la empresa',c.descripcion]];document.getElementById('companyDetails').innerHTML=details.map(([k,v])=>`<div class="detail"><small>${esc(k)}</small><div class="description">${esc(v||'--')}</div></div>`).join('');const people=data.people.filter(p=>Number(p.empresa_id)===Number(c.empresa_id));document.getElementById('modalPeople').innerHTML=people.length?people.map(p=>`<tr><td>${esc(p.folio)}</td><td>${full(p)}</td><td>${esc(p.puesto)}</td><td>${bar(p.progreso)}</td><td>${p.calificacion}%</td><td>${p.intentos}</td><td>${badge(p.aprobado?'APROBADO':p.estatus)}</td></tr>`).join(''):'<tr><td colspan="7" class="empty">Esta empresa aun no tiene colaboradores.</td></tr>';document.getElementById('companyModal').classList.add('open')}
function closeCompany(){document.getElementById('companyModal').classList.remove('open')}
function full(p){return esc([p.nombres,p.apellido_paterno,p.apellido_materno].filter(Boolean).join(' '))}document.querySelectorAll('.nav button').forEach(b=>b.onclick=()=>{document.querySelectorAll('.nav button').forEach(x=>x.classList.remove('active'));b.classList.add('active');activeView=b.dataset.view;document.querySelectorAll('.view').forEach(x=>x.classList.toggle('active',x.id===activeView));const titles={dashboard:'Centro de control',companies:'Empresas',people:'Colaboradores',failed:'Colaboradores reprobados'};document.getElementById('title').textContent=titles[activeView];render()});document.querySelectorAll('.toolbar input,.toolbar select').forEach(x=>x.addEventListener('input',render));
function clearFilters(){document.querySelectorAll(`#${activeView} .toolbar input,#${activeView} .toolbar select`).forEach(x=>x.value='');render()}function logout(){sessionStorage.clear();location.replace('/admin-login.html')}
async function certificate(id,folio){const r=await fetch(`/admin-personas/${id}/constancia`,{headers:{Authorization:'Bearer '+token}});if(!r.ok){Swal.fire('Error','Constancia no disponible','error');return}const u=URL.createObjectURL(await r.blob()),a=document.createElement('a');a.href=u;a.download=`constancia-${folio}.pdf`;a.click();URL.revokeObjectURL(u)}
function exportExcel(){let rows;if(activeView==='companies'||activeView==='dashboard')rows=(activeView==='dashboard'?data.companies:visible).map(c=>({Folio:c.folio,Empresa:c.nombre||c.empresa_autorizada,'Razon social':c.razon_social||'',Representante:c.representante_legal||'',Telefono:c.telefono_1||'',Correo:c.correo_1||'',Estado:c.estatus,Caducidad:date(c.caducidad),Colaboradores:c.colaboradores,Aprobados:c.aprobados||0,'Avance promedio':c.progreso_promedio||0}));else rows=visible.map(p=>({Folio:p.folio,Nombre:[p.nombres,p.apellido_paterno,p.apellido_materno].filter(Boolean).join(' '),Empresa:p.empresa,Puesto:p.puesto,Telefono:p.telefono,Correo:p.correo,Avance:p.progreso,Calificacion:p.calificacion,Intentos:p.intentos,Estado:p.aprobado?'APROBADO':'REPROBADO'}));if(!rows.length)return Swal.fire('Sin datos','No hay registros para exportar','info');const headers=Object.keys(rows[0]),csv='\ufeff'+[headers.join(','),...rows.map(r=>headers.map(h=>'"'+String(r[h]??'').replace(/"/g,'""')+'"').join(','))].join('\r\n'),blob=new Blob([csv],{type:'text/csv;charset=utf-8'}),u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download=`TIA-${activeView}-${new Date().toISOString().slice(0,10)}.csv`;a.click();URL.revokeObjectURL(u)}load();

const originalRender=render,originalExportExcel=exportExcel;
function filteredTokens(){const q=(document.getElementById('tokenSearch')?.value||'').toLowerCase(),st=document.getElementById('tokenStatus')?.value||'',from=document.getElementById('tokenFrom')?.value||'',to=document.getElementById('tokenTo')?.value||'';return data.companies.filter(t=>{const hay=[t.folio,t.empresa_autorizada,t.nombre].join(' ').toLowerCase(),d=(t.fecha_emision||'').slice(0,10);return(!q||hay.includes(q))&&(!st||t.estatus===st)&&(!from||d>=from)&&(!to||d<=to)})}
render=function(){if(activeView!=='tokens')return originalRender();visible=filteredTokens();document.getElementById('tokenRows').innerHTML=visible.map(t=>`<tr><td class="token-code">${esc(t.folio)}</td><td>${esc(t.nombre||t.empresa_autorizada||'Sin vincular')}</td><td>${date(t.fecha_emision)}</td><td>${date(t.caducidad)}</td><td>${badge(t.estatus)}</td><td><button class="view-btn" onclick="copyToken('${esc(t.folio)}')">Copiar</button> <button class="secondary" style="padding:7px 9px" onclick="openTokenDetail(${Number(t.id)})">Ver</button> ${['ACTIVO','SUSPENDIDO'].includes(t.estatus)?`<button class="secondary" style="padding:7px 9px" onclick="changeTokenStatus(${t.id},'${t.estatus==='ACTIVO'?'SUSPENDIDO':'ACTIVO'}')">${t.estatus==='ACTIVO'?'Suspender':'Reactivar'}</button>`:''}</td></tr>`).join('')};
exportExcel=function(){if(activeView!=='tokens')return originalExportExcel();const rows=visible.map(t=>({Token:t.folio,'Empresa vinculada':t.nombre||t.empresa_autorizada||'Sin vincular',Emision:date(t.fecha_emision),Caducidad:date(t.caducidad),Estado:t.estatus}));if(!rows.length)return Swal.fire('Sin datos','No hay tokens para exportar','info');const hs=Object.keys(rows[0]),csv='\ufeff'+[hs.join(','),...rows.map(r=>hs.map(k=>'"'+String(r[k]||'').replace(/"/g,'""')+'"').join(','))].join('\r\n'),u=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=u;a.download='TIA-tokens-'+new Date().toISOString().slice(0,10)+'.csv';a.click();URL.revokeObjectURL(u)};
const tokenNav=document.querySelector('[data-view="tokens"]');tokenNav.onclick=()=>{document.querySelectorAll('.nav button').forEach(x=>x.classList.remove('active'));tokenNav.classList.add('active');activeView='tokens';document.querySelectorAll('.view').forEach(x=>x.classList.toggle('active',x.id==='tokens'));document.getElementById('title').textContent='Tokens empresariales';document.getElementById('subtitle').textContent='Generacion y seguimiento de accesos para empresas';render()};
['tokenSearch','tokenStatus','tokenFrom','tokenTo'].forEach(id=>document.getElementById(id).addEventListener('input',render));
let lastGeneratedTokens=[];function openTokenModal(){lastGeneratedTokens=[];document.getElementById('generatedTokens').innerHTML='';document.getElementById('tokenModal').classList.add('open')}function closeTokenModal(){document.getElementById('tokenModal').classList.remove('open')}async function copyToken(value){await navigator.clipboard.writeText(value);Swal.fire({toast:true,position:'top-end',icon:'success',title:'Token copiado',showConfirmButton:false,timer:1300})}async function copyAllTokens(){if(!lastGeneratedTokens.length)return;await navigator.clipboard.writeText(lastGeneratedTokens.join('\n'));Swal.fire({toast:true,position:'top-end',icon:'success',title:lastGeneratedTokens.length+' tokens copiados',showConfirmButton:false,timer:1600})}
async function changeTokenStatus(id,estatus){const r=await fetch('/admin-tokens/'+id+'/status',{method:'PATCH',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({estatus})});const x=await r.json();if(!r.ok)return Swal.fire('Error',x.error||'No fue posible actualizar','error');await load();render()}
async function openTokenDetail(id){const r=await fetch('/admin-tokens/'+id+'/detalle',{headers:{Authorization:'Bearer '+token}}),x=await r.json().catch(()=>({}));if(!r.ok||!x.ok)return Swal.fire('Error',x.error||'No fue posible consultar el token','error');const t=x.token,accounts=x.cuentas||[];const company=t.nombre||t.empresa||'Sin empresa vinculada';const accountRows=accounts.length?accounts.map(a=>`<tr><td>${esc(a.nombre||a.usuario)}</td><td><b>${esc(a.usuario)}</b></td><td>${badge(a.activo?'USADO':'SUSPENDIDO')}</td><td><button class="view-btn" onclick="resetEnterprisePassword(${Number(t.id)},${Number(a.id)},${esc(JSON.stringify(a.usuario))})">Restablecer contraseña</button></td></tr>`).join(''):'<tr><td colspan="4" style="padding:16px;color:#93a4ba">La empresa todavía no ha creado cuentas de acceso.</td></tr>';await Swal.fire({title:'Detalle del token',width:920,html:`<div style="text-align:left"><p><b>Token:</b> <span style="font-family:Consolas;color:#6ee7a0">${esc(t.folio)}</span><br><b>Empresa:</b> ${esc(company)}<br><b>Estado:</b> ${esc(t.estatus)}<br><b>Representante:</b> ${esc(t.representante_legal||'--')}<br><b>Contacto:</b> ${esc(t.correo_1||t.telefono_1||'--')}</p><hr style="border-color:#263449"><h3>Cuentas autorizadas</h3><div style="overflow:auto"><table style="width:100%;border-collapse:collapse;min-width:680px"><thead><tr><th>Nombre</th><th>Usuario</th><th>Estado</th><th>Acción</th></tr></thead><tbody>${accountRows}</tbody></table></div><p style="color:#93a4ba;font-size:12px">Por seguridad, las contraseñas actuales no se pueden consultar. Solo puedes establecer una nueva contraseña.</p></div>`,showConfirmButton:true,confirmButtonText:'Cerrar',buttonsStyling:false,customClass:{popup:'tia-modal',confirmButton:'tia-secondary'}});}
async function resetEnterprisePassword(tokenId,accountId,usuario){const prompt=await Swal.fire({title:'Restablecer contraseña',html:`Define una nueva contraseña para <strong>${esc(usuario)}</strong>. Se cerrarán sus sesiones actuales.`,input:'password',inputPlaceholder:'Nueva contraseña (mínimo 8 caracteres)',inputAttributes:{minlength:'8',autocomplete:'new-password'},showCancelButton:true,confirmButtonText:'Restablecer',cancelButtonText:'Cancelar',buttonsStyling:false,customClass:{popup:'tia-modal',confirmButton:'tia-primary',cancelButton:'tia-secondary'},preConfirm:value=>{if(!value||value.length<8){Swal.showValidationMessage('La contraseña debe tener al menos 8 caracteres');return false}return value}});if(!prompt.isConfirmed)return;const r=await fetch(`/admin-tokens/${tokenId}/cuentas/${accountId}/restablecer-password`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({password:prompt.value})}),x=await r.json().catch(()=>({}));if(!r.ok||!x.ok)return Swal.fire('Error',x.error||'No fue posible restablecer la contraseña','error');await Swal.fire({title:'Contraseña restablecida',text:'La nueva contraseña fue guardada y las sesiones de esta cuenta se cerraron.',icon:'success',buttonsStyling:false,customClass:{popup:'tia-modal',confirmButton:'tia-primary'}});openTokenDetail(tokenId)}
document.getElementById('tokenForm').addEventListener('submit',async e=>{e.preventDefault();const payload=Object.fromEntries(new FormData(e.currentTarget));const r=await fetch('/admin-tokens',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(payload)});const x=await r.json();if(!r.ok)return Swal.fire('Error',x.error||'No fue posible generar','error');lastGeneratedTokens=x.tokens.map(t=>t.token);document.getElementById('generatedTokens').innerHTML=`<button class="primary" type="button" onclick="copyAllTokens()">Copiar todos (${lastGeneratedTokens.length})</button>`+x.tokens.map(t=>`<div>${esc(t.token)} <button class="view-btn" type="button" onclick="copyToken('${esc(t.token)}')">Copiar</button></div>`).join('');await load();activeView='tokens';render()});

let internalUsers=[];
document.querySelector('[data-view="tokens"]').insertAdjacentHTML('afterend','<button data-view="users" style="display:none">♙ <span>Usuarios internos</span></button>');
document.querySelector('#tokens').insertAdjacentHTML('afterend','<section class="view" id="users"><div class="panel"><div class="toolbar"><input id="userSearch" placeholder="Buscar nombre o usuario"><select id="userStatus"><option value="">Todos los estados</option><option value="1">Activos</option><option value="0">Inactivos</option></select><span></span><span></span><span></span><button class="primary" onclick="openUserModal()">+ Crear usuario</button></div><div class="table-wrap"><table><thead><tr><th>Nombre</th><th>Usuario</th><th>Perfil</th><th>Fecha de alta</th><th>Estado</th><th>Acciones</th></tr></thead><tbody id="userRows"></tbody></table></div></div></section>');
document.body.insertAdjacentHTML('beforeend','<div class="company-modal" id="userModal"><div class="modal-card" style="max-width:560px"><div class="modal-head"><div><h2>Crear usuario de gestión</h2><p>Podrá consultar y exportar información, pero no administrar tokens.</p></div><button class="close" onclick="closeUserModal()">Cerrar</button></div><form class="token-form" id="userForm"><label>Nombre completo<input name="name" minlength="3" maxlength="120" required></label><label>Nombre de usuario<input name="usuario" minlength="4" maxlength="40" pattern="[-_.a-zA-Z0-9]+" autocomplete="off" required></label><label>Contraseña temporal<input name="password" type="password" minlength="8" autocomplete="new-password" required></label><button class="primary" type="submit">Crear usuario de gestión</button></form></div></div>');
const usersNav=document.querySelector('[data-view="users"]'),usersRender=render,usersExport=exportExcel;
function filteredUsers(){const q=(document.getElementById('userSearch').value||'').toLowerCase(),st=document.getElementById('userStatus').value;return internalUsers.filter(u=>(!q||[u.name,u.usuario].join(' ').toLowerCase().includes(q))&&(!st||String(u.activo)===st))}
render=function(){if(activeView!=='users')return usersRender();visible=filteredUsers();document.getElementById('userRows').innerHTML=visible.map(u=>`<tr><td>${esc(u.name)}</td><td><b>${esc(u.usuario||'--')}</b></td><td>${esc(u.rol==='SUPERADMIN'?'Administrador principal':'Gestión')}</td><td>${date(u.creado_en)}</td><td>${badge(u.activo?'ACTIVO':'SUSPENDIDO')}</td><td>${u.rol==='GESTOR'?`<button class="secondary" onclick="changeUserStatus(${u.id},${u.activo?0:1})">${u.activo?'Desactivar':'Activar'}</button>`:'--'}</td></tr>`).join('')||'<tr><td colspan="6" class="empty">No hay usuarios registrados.</td></tr>'};
exportExcel=function(){if(activeView!=='users')return usersExport();const rows=visible.map(u=>({Nombre:u.name,Usuario:u.usuario,Perfil:u.rol,Estado:u.activo?'ACTIVO':'INACTIVO','Fecha de alta':date(u.creado_en)}));if(!rows.length)return Swal.fire('Sin datos','No hay usuarios para exportar','info');const hs=Object.keys(rows[0]),csv='\ufeff'+[hs.join(','),...rows.map(r=>hs.map(k=>'"'+String(r[k]||'').replace(/"/g,'""')+'"').join(','))].join('\r\n'),url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='TIA-usuarios-'+new Date().toISOString().slice(0,10)+'.csv';a.click();URL.revokeObjectURL(url)};
usersNav.onclick=()=>{document.querySelectorAll('.nav button').forEach(x=>x.classList.remove('active'));usersNav.classList.add('active');activeView='users';document.querySelectorAll('.view').forEach(x=>x.classList.toggle('active',x.id==='users'));document.getElementById('title').textContent='Usuarios internos';document.getElementById('subtitle').textContent='Cuentas con acceso de consulta y gestión';render()};
document.getElementById('userSearch').addEventListener('input',render);document.getElementById('userStatus').addEventListener('input',render);
function openUserModal(){document.getElementById('userForm').reset();document.getElementById('userModal').classList.add('open')}function closeUserModal(){document.getElementById('userModal').classList.remove('open')}
async function loadInternalUsers(){const r=await fetch('/admin-users',{headers:{Authorization:'Bearer '+token}});if(!r.ok)return;const x=await r.json();internalUsers=x.users||[];render()}
async function changeUserStatus(id,activo){const r=await fetch('/admin-users/'+id+'/status',{method:'PATCH',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({activo:!!activo})});const x=await r.json();if(!r.ok)return Swal.fire('Error',x.error||'No fue posible actualizar','error');await loadInternalUsers()}
document.getElementById('userForm').addEventListener('submit',async e=>{e.preventDefault();const payload=Object.fromEntries(new FormData(e.currentTarget));const r=await fetch('/admin-users',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(payload)});const x=await r.json();if(!r.ok)return Swal.fire('Error',x.error||'No fue posible crear el usuario','error');closeUserModal();await loadInternalUsers();Swal.fire('Usuario creado','La cuenta de gestión ya puede iniciar sesión.','success')});
(async()=>{const r=await fetch('/admin-overview',{headers:{Authorization:'Bearer '+token}});if(!r.ok)return;const x=await r.json(),isSuper=x.admin?.rol==='SUPERADMIN';document.querySelector('[data-view="tokens"]').style.display=isSuper?'':'none';usersNav.style.display=isSuper?'':'none';if(isSuper)await loadInternalUsers()})();

const photoAwareRender=render;render=function(){if(activeView!=='people')return photoAwareRender();visible=personFilter(false);document.getElementById('peopleRows').innerHTML=visible.map(p=>{let finalStatus=p.estatus,actions='--';if(p.aprobado&&p.foto_estatus==='APROBADA'){finalStatus='CONCLUIDO';actions=`<button class="download" onclick="certificate(${p.id},'${esc(p.folio)}')">PDF</button> <button class="view-btn" onclick="downloadPhoto(${p.id},'${esc(p.folio)}')">Foto</button>`}else if(p.aprobado&&p.photo&&p.foto_estatus==='PENDIENTE'){finalStatus='FOTO POR VALIDAR';actions=`<button class="view-btn" onclick="reviewPhoto(${p.id},'${esc(p.folio)}','${esc(full(p))}')">Revisar foto</button>`}else if(p.aprobado&&p.foto_estatus==='RECHAZADA'){finalStatus='FOTO RECHAZADA';actions='<small>Esperando nueva captura</small>'}else if(p.aprobado){finalStatus='FOTO PENDIENTE';actions='<small>Fotografía pendiente</small>'}return `<tr><td>${esc(p.folio)}</td><td>${full(p)}</td><td>${esc(p.empresa)}</td><td>${esc(p.puesto)}<br><small>${esc(p.correo)}</small></td><td>${bar(p.progreso)}</td><td>${p.calificacion}%</td><td>${p.intentos}</td><td>${badge(finalStatus)}</td><td>${actions}</td></tr>`}).join('')};
async function downloadPhoto(id,folio){const r=await fetch(`/admin-personas/${id}/fotografia`,{headers:{Authorization:'Bearer '+token}});if(!r.ok){let d={};try{d=await r.json()}catch{}return Swal.fire('Error',d.error||'Fotografía no disponible','error')}const u=URL.createObjectURL(await r.blob()),a=document.createElement('a');a.href=u;a.download=`fotografia-${folio}.jpg`;a.click();URL.revokeObjectURL(u)}
async function downloadCommitment(id,folio){const r=await fetch(`/admin-personas/${id}/carta-compromiso`,{headers:{Authorization:'Bearer '+token}});if(!r.ok){const d=await r.json().catch(()=>({}));return Swal.fire('Error',d.error||'Carta de aceptación no disponible','error')}const u=URL.createObjectURL(await r.blob()),a=document.createElement('a');a.href=u;a.download=`carta-compromiso-${folio}.pdf`;a.click();URL.revokeObjectURL(u)}
let reviewPhotoId=null,reviewPhotoUrl='';document.body.insertAdjacentHTML('beforeend','<div class="company-modal" id="photoReviewModal"><div class="modal-card" style="max-width:650px;text-align:center"><div class="modal-head"><div style="text-align:left"><h2>Validar fotografía</h2><p id="reviewPhotoInfo"></p></div><button class="close" onclick="closePhotoReview()">Cerrar</button></div><img id="reviewPhotoImage" alt="Fotografía del colaborador" style="display:block;max-width:340px;width:100%;max-height:480px;object-fit:contain;background:white;margin:20px auto;border-radius:12px;border:4px solid white"><div style="display:flex;gap:12px;justify-content:center"><button class="secondary" style="background:#b91c1c" onclick="rejectPhoto()">Rechazar</button><button class="primary" onclick="acceptPhoto()">Aceptar fotografía</button></div></div></div>');
async function reviewPhoto(id,folio,nombre){closePhotoReview();const r=await fetch(`/admin-personas/${id}/fotografia?preview=1`,{headers:{Authorization:'Bearer '+token}});if(!r.ok)return Swal.fire('Error','Fotografía no disponible','error');reviewPhotoId=id;reviewPhotoUrl=URL.createObjectURL(await r.blob());document.getElementById('reviewPhotoImage').src=reviewPhotoUrl;document.getElementById('reviewPhotoInfo').textContent=`${nombre} · ${folio}`;document.getElementById('photoReviewModal').classList.add('open')}
function closePhotoReview(){document.getElementById('photoReviewModal')?.classList.remove('open');if(reviewPhotoUrl)URL.revokeObjectURL(reviewPhotoUrl);reviewPhotoUrl='';reviewPhotoId=null}
async function decidePhoto(decision,motivo=''){const id=reviewPhotoId,r=await fetch(`/admin-personas/${id}/fotografia`,{method:'PATCH',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({decision,motivo})}),x=await r.json();if(!r.ok)return Swal.fire('Error',x.error||'No fue posible validar','error');closePhotoReview();await load();if(decision==='ACEPTAR')return Swal.fire({icon:x.emailSent?'success':'warning',title:'Fotografía aceptada',text:x.emailSent?`La constancia quedó habilitada y se notificó a ${x.email}.`:x.warning});return Swal.fire({icon:x.emailSent?'success':'warning',title:'Fotografía rechazada',text:x.emailSent?`Se notificó automáticamente a ${x.email}.`:x.warning})}
function acceptPhoto(){Swal.fire({title:'¿Aceptar fotografía?',text:'Esto habilitará la constancia del colaborador.',icon:'question',showCancelButton:true,confirmButtonText:'Sí, aceptar',cancelButtonText:'Cancelar'}).then(r=>{if(r.isConfirmed)decidePhoto('ACEPTAR')})}
async function rejectPhoto(){const r=await Swal.fire({title:'Rechazar fotografía',input:'textarea',inputLabel:'Motivo que recibirá la empresa',inputPlaceholder:'Ejemplo: el rostro no se aprecia de frente.',inputValidator:v=>String(v||'').trim().length<5?'Escribe el motivo del rechazo':undefined,showCancelButton:true,confirmButtonText:'Rechazar y notificar',cancelButtonText:'Cancelar',confirmButtonColor:'#b91c1c'});if(r.isConfirmed)decidePhoto('RECHAZAR',r.value.trim())}
reviewPhoto=async function(id){closePhotoReview();const person=data.people.find(p=>Number(p.id)===Number(id)),r=await fetch(`/admin-personas/${id}/fotografia?preview=1`,{headers:{Authorization:'Bearer '+token}});if(!r.ok)return Swal.fire('Error','Fotografía no disponible','error');reviewPhotoId=id;reviewPhotoUrl=URL.createObjectURL(await r.blob());document.getElementById('reviewPhotoImage').src=reviewPhotoUrl;document.getElementById('reviewPhotoInfo').textContent=person?`${[person.nombres,person.apellido_paterno,person.apellido_materno].filter(Boolean).join(' ')} · ${person.folio}`:'Colaborador';document.getElementById('photoReviewModal').classList.add('open')};
const reviewAwareOpenCompany=openCompany;openCompany=function(id){reviewAwareOpenCompany(id);const c=data.companies.find(x=>Number(x.id)===Number(id));if(!c)return;const people=data.people.filter(p=>Number(p.empresa_id)===Number(c.empresa_id));document.getElementById('modalPeople').innerHTML=people.length?people.map(p=>{let st=p.estatus;if(p.aprobado&&p.foto_estatus==='APROBADA')st='CONCLUIDO';else if(p.aprobado&&p.foto_estatus==='PENDIENTE')st='FOTO POR VALIDAR';else if(p.aprobado&&p.foto_estatus==='RECHAZADA')st='FOTO RECHAZADA';else if(p.aprobado)st='FOTO PENDIENTE';return `<tr><td>${esc(p.folio)}</td><td>${full(p)}</td><td>${esc(p.puesto)}</td><td>${bar(p.progreso)}</td><td>${p.calificacion}%</td><td>${p.intentos}</td><td>${badge(st)}</td></tr>`}).join(''):'<tr><td colspan="7" class="empty">Esta empresa aun no tiene colaboradores.</td></tr>'};
const renderWithCommitment=render;render=function(){renderWithCommitment();if(activeView!=='people')return;[...document.getElementById('peopleRows').rows].forEach((row,index)=>{const person=visible[index];if(person?.carta_aceptada_en&&!row.lastElementChild.querySelector('[data-carta]'))row.lastElementChild.insertAdjacentHTML('beforeend',` <button class="view-btn" data-carta onclick="downloadCommitment(${Number(person.id)},'${esc(person.folio)}')">Carta aceptación</button>`)});};
const originalOpenCompanyWithPhoto=openCompany;openCompany=function(id){originalOpenCompanyWithPhoto(id);const c=data.companies.find(x=>Number(x.id)===Number(id));if(!c)return;const people=data.people.filter(p=>Number(p.empresa_id)===Number(c.empresa_id));document.getElementById('modalPeople').innerHTML=people.length?people.map(p=>{const st=p.suspendido_en?'SUSPENDIDO':p.aprobado?(p.photo?'CONCLUIDO':'FOTO PENDIENTE'):p.estatus;return `<tr><td>${esc(p.folio)}</td><td>${full(p)}</td><td>${esc(p.puesto)}</td><td>${bar(p.progreso)}</td><td>${p.calificacion}%</td><td>${p.intentos}</td><td>${badge(st)}</td></tr>`}).join(''):'<tr><td colspan="7" class="empty">Esta empresa aun no tiene colaboradores.</td></tr>'};

let selectedCompanyForSuspension=null;
const companySuspendControl=document.createElement('div');
companySuspendControl.style.cssText='display:flex;justify-content:flex-end;margin:0 0 18px';
document.getElementById('companyDetails').after(companySuspendControl);
const openCompanyWithSuspensionControl=openCompany;
openCompany=function(id){
  openCompanyWithSuspensionControl(id);
  const company=data.companies.find(item=>Number(item.id)===Number(id));
  selectedCompanyForSuspension=company||null;
  const canSuspend=company&&company.estatus!=="SUSPENDIDO"&&data.admin?.rol==='SUPERADMIN';
  companySuspendControl.innerHTML=canSuspend?'<button type="button" style="background:#b91c1c;border:0;color:#fff;font-weight:700;padding:9px 13px;border-radius:8px;cursor:pointer" onclick="suspendCompanyAccess()">Suspender folio y accesos</button>':company?.estatus==='SUSPENDIDO'&&data.admin?.rol==='SUPERADMIN'?'<button type="button" class="primary" onclick="reactivateCompanyAccess()">Reactivar folio y accesos</button>':'<span class="badge red">FOLIO SUSPENDIDO</span>';
};
async function suspendCompanyAccess(){
  const company=selectedCompanyForSuspension;
  if(!company)return;
  const result=await Swal.fire({
    icon:'warning',
    title:'¿Suspender folio de empresa?',
    html:`<p>La empresa <strong>${esc(company.nombre||company.empresa_autorizada||company.folio)}</strong> no será eliminada.</p><p>Su folio, cuenta empresarial y los folios de acceso de todos sus colaboradores quedarán suspendidos de inmediato.</p><p>La información seguirá disponible para consulta desde administración.</p>`,
    showCancelButton:true,
    confirmButtonText:'Sí, suspender accesos',
    cancelButtonText:'Cancelar',
    confirmButtonColor:'#b91c1c'
  });
  if(!result.isConfirmed)return;
  const response=await fetch(`/admin-empresas/${company.id}/suspender`,{method:'PATCH',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:'{}'});
  const payload=await response.json().catch(()=>({}));
  if(!response.ok||!payload.ok)return Swal.fire('No fue posible suspender',payload.error||'Intenta nuevamente','error');
  closeCompany();
  await load();
  activeView='companies';
  render();
  Swal.fire('Folios suspendidos','La empresa no fue eliminada. Su acceso y el de sus colaboradores quedaron suspendidos; la información permanece disponible para consulta.','success');
}

async function reactivateCompanyAccess(){
  const company=selectedCompanyForSuspension;
  if(!company)return;
  const result=await Swal.fire({icon:'question',title:'Reactivar folio y accesos',html:`<p>Se restaurará el acceso de <strong>${esc(company.nombre||company.empresa_autorizada||company.folio)}</strong>, sus cuentas autorizadas y sus colaboradores.</p><p>Las sesiones anteriores permanecen cerradas; cada persona deberá iniciar sesión nuevamente.</p>`,showCancelButton:true,confirmButtonText:'Si, reactivar accesos',cancelButtonText:'Cancelar',confirmButtonColor:'#16a34a'});
  if(!result.isConfirmed)return;
  const response=await fetch(`/admin-empresas/${company.id}/reactivar`,{method:'PATCH',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:'{}'});
  const payload=await response.json().catch(()=>({}));
  if(!response.ok||!payload.ok)return Swal.fire('No fue posible reactivar',payload.error||'Intenta nuevamente','error');
  closeCompany();
  await load();
  activeView='companies';
  render();
  Swal.fire('Accesos reactivados','El folio, las cuentas autorizadas y los colaboradores ya pueden volver a ingresar al sistema.','success');
}

const renderWithCourseDate=render;
render=function(){
  renderWithCourseDate();
  if(activeView!=="people")return;
  const table=document.getElementById('peopleRows');
  const header=table?.closest('table')?.querySelector('thead tr');
  if(!table||!header)return;
  if(header.children.length===9){
    const cell=document.createElement('th');
    cell.textContent='Fecha de curso';
    header.insertBefore(cell,header.children[6]);
  }
  [...table.rows].forEach((row,index)=>{
    if(row.children.length!==9)return;
    const cell=document.createElement('td');
    const person=visible[index];
    cell.textContent=person?.fecha_aprobacion?date(person.fecha_aprobacion):'--';
    row.insertBefore(cell,row.children[6]);
  });
};

const exportWithCourseDate=exportExcel;
exportExcel=function(){
  if(activeView!=="people")return exportWithCourseDate();
  const rows=visible.map(person=>({
    Folio:person.folio,
    Nombre:[person.nombres,person.apellido_paterno,person.apellido_materno].filter(Boolean).join(' '),
    Empresa:person.empresa,
    Puesto:person.puesto,
    Correo:person.correo,
    Avance:person.progreso,
    Calificacion:person.calificacion,
    'Fecha de curso':person.fecha_aprobacion?date(person.fecha_aprobacion):'',
    Intentos:person.intentos,
    Estado:person.suspendido_en?'SUSPENDIDO':person.aprobado?'APROBADO':person.estatus
  }));
  if(!rows.length)return Swal.fire('Sin datos','No hay colaboradores para exportar','info');
  const headers=Object.keys(rows[0]),csv='\ufeff'+[headers.join(','),...rows.map(row=>headers.map(key=>'"'+String(row[key]??'').replace(/"/g,'""')+'"').join(','))].join('\r\n');
  const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'})),anchor=document.createElement('a');
  anchor.href=url;anchor.download=`TIA-colaboradores-${new Date().toISOString().slice(0,10)}.csv`;anchor.click();URL.revokeObjectURL(url);
};

function ensureCourseDateColumn(){
  if(activeView!=="people")return;
  const table=document.getElementById('peopleRows');
  const header=table?.closest('table')?.querySelector('thead tr');
  if(!table||!header)return;
  if(header.children.length===9){
    const cell=document.createElement('th');
    cell.textContent='Fecha de curso';
    header.insertBefore(cell,header.children[6]);
  }
  [...table.rows].forEach((row,index)=>{
    if(row.children.length!==9)return;
    const cell=document.createElement('td');
    const person=visible[index];
    cell.textContent=person?.fecha_aprobacion?date(person.fecha_aprobacion):'--';
    row.insertBefore(cell,row.children[6]);
  });
}
new MutationObserver(ensureCourseDateColumn).observe(document.getElementById('peopleRows'),{childList:true});
document.querySelectorAll('input[type="date"]').forEach(input=>input.addEventListener('click',()=>{
  try{input.showPicker?.()}catch{}
}));

async function downloadApprovedExam(id,folio){
  const response=await fetch(`/admin-personas/${id}/examen`,{headers:{Authorization:'Bearer '+token}});
  if(!response.ok){const data=await response.json().catch(()=>({}));return Swal.fire('Error',data.error||'Examen no disponible','error');}
  const url=URL.createObjectURL(await response.blob()),anchor=document.createElement('a');
  anchor.href=url;anchor.download=`examen-${folio}.pdf`;anchor.click();URL.revokeObjectURL(url);
}

const renderWithExamAudit=render;
render=function(){
  renderWithExamAudit();
  if(activeView!=="people")return;
  [...document.getElementById('peopleRows').rows].forEach((row,index)=>{
    const person=visible[index],actionCell=row.lastElementChild;
    if(person?.examen_auditado_id&&!actionCell.querySelector('[data-examen]'))actionCell.insertAdjacentHTML('beforeend',` <button class="view-btn" data-examen onclick="downloadApprovedExam(${Number(person.id)},'${esc(person.folio)}')">Examen</button>`);
  });
};

/* Acciones documentales uniformes para el expediente del colaborador. */
document.head.insertAdjacentHTML('beforeend',`<style>
.action-icons{display:flex;align-items:center;gap:6px;white-space:nowrap}.action-icon{width:32px;height:32px;border:1px solid #31527a;border-radius:8px;background:#1646b8;color:#fff;display:inline-grid;place-items:center;font-size:16px;cursor:pointer;transition:transform .15s,background .15s}.action-icon:hover:not(:disabled){background:#2563eb;transform:translateY(-1px)}.action-icon.photo{background:#0f766e;border-color:#2dd4bf}.action-icon.document{background:#7c3aed;border-color:#a78bfa}.action-icon.exam{background:#b7791f;border-color:#e7bd69}.action-icon:disabled{background:#263449;border-color:#334155;color:#718096;cursor:not-allowed;opacity:.75}
</style>`);
function actionIcon({kind,label,enabled,onClick}){return `<button type="button" class="action-icon ${kind}" title="${esc(label)}" aria-label="${esc(label)}"${enabled?` onclick="${onClick}"`:" disabled"}>${kind==='pdf'?'📄':kind==='photo'?'🖼️':kind==='document'?'✍️':'📝'}</button>`}
const renderWithDocumentIcons=render;
render=function(){
  renderWithDocumentIcons();
  if(activeView!=="people")return;
  const header=document.getElementById('peopleRows')?.closest('table')?.querySelector('thead tr th:last-child');
  if(header)header.textContent='Documentos';
  [...document.getElementById('peopleRows').rows].forEach((row,index)=>{
    const person=visible[index];if(!person)return;
    const canDownloadCertificate=Boolean(person.aprobado&&person.foto_estatus==='APROBADA');
    const hasApprovedPhoto=Boolean(person.aprobado&&person.foto_estatus==='APROBADA');
    const hasPendingPhoto=Boolean(person.aprobado&&person.photo&&person.foto_estatus==='PENDIENTE');
    const canReviewOrDownloadPhoto=hasApprovedPhoto||hasPendingPhoto;
    const photoClick=hasApprovedPhoto?`downloadPhoto(${Number(person.id)},'${esc(person.folio)}')`:hasPendingPhoto?`reviewPhoto(${Number(person.id)})`:'';
    const cell=row.lastElementChild;
    cell.innerHTML=`<div class="action-icons">${actionIcon({kind:'document',label:person.carta_aceptada_en?'Descargar carta de aceptación':'Carta de aceptación no disponible',enabled:Boolean(person.carta_aceptada_en),onClick:`downloadCommitment(${Number(person.id)},'${esc(person.folio)}')`})}${actionIcon({kind:'photo',label:hasApprovedPhoto?'Descargar fotografía':hasPendingPhoto?'Revisar fotografía':'Fotografía no disponible',enabled:canReviewOrDownloadPhoto,onClick:photoClick})}${actionIcon({kind:'exam',label:person.examen_auditado_id?'Descargar examen aprobado':'Examen auditado no disponible',enabled:Boolean(person.examen_auditado_id),onClick:`downloadApprovedExam(${Number(person.id)},'${esc(person.folio)}')`})}${actionIcon({kind:'pdf',label:canDownloadCertificate?'Descargar constancia PDF':'Constancia no disponible',enabled:canDownloadCertificate,onClick:`certificate(${Number(person.id)},'${esc(person.folio)}')`})}</div>`;
  });
};
