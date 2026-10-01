# MANUAL FUNCIONAL EMPRESAS — TIAS Cursos

Documento de análisis funcional para construir el Manual de Usuario para Empresas. Elaborado contra el frontend y backend actuales. No describe el portal administrativo interno, salvo cuando es indispensable para explicar un estado que la empresa observa.

## Convenciones de certeza

- **CONFIRMADO EN CÓDIGO:** existe interfaz y ruta backend utilizable.
- **NO IMPLEMENTADO ACTUALMENTE:** no está disponible para la empresa, aunque la interfaz antigua conserve referencias visuales.
- **DIFERENCIA INTERFAZ/BACKEND:** la pantalla puede mostrar una opción, pero el código que se ejecuta no la permite.

## 1. Acceso inicial de la empresa

### Flujo real

`Token empresarial recibido → pantalla / → registro de empresa (/empresa.html) → creación de cuenta (/cuenta.html) → requisitos (/empresa-requisitos.html) → panel (/empresa-panel.html)`.

1. Administración interna genera el **token empresarial** (folio con formato `TIA-E-...`). La empresa no puede generarlo.
2. La empresa escribe el token en la pantalla raíz `/` y pulsa **Ingresar**.
3. Si está activo y no se ha usado, se crea una sesión temporal de registro de 30 minutos y se abre `/empresa.html`.
4. Se capturan datos de la empresa; al guardarlos el token queda `CONFIGURANDO` y se crea una sesión temporal para configurar cuenta (30 minutos).
5. En `/cuenta.html` se define usuario y contraseña. Al concluir, el token queda `USADO`, se crea la primera cuenta empresarial y una sesión de gestión de ocho horas.

### Token empresarial

| Situación | Comportamiento confirmado |
| --- | --- |
| Activo y vigente | Permite iniciar el registro. |
| Vencido | Se marca `VENCIDO` y muestra “Este folio ha caducado”. |
| Suspendido/no activo | Muestra “Este folio no se encuentra activo”. |
| No encontrado | Muestra “Folio no encontrado”. |
| Usado | Solicita usuario y contraseña de empresa, no vuelve a registrar la empresa. |
| Configurando | Retoma la creación de cuenta si ya existe empresa pero aún no hay cuenta. |
| Uso | Es de un solo uso para vincular/activar a la empresa; posteriormente identifica el acceso empresarial. |

### Datos obligatorios de empresa

Nombre de empresa, razón social, representante legal, teléfono principal, teléfono alterno, correo principal, correo alterno, dirección y descripción de actividades. Ambos correos deben cumplir formato de correo. Todos los campos son obligatorios en backend.

**DIFERENCIA INTERFAZ/BACKEND:** el nombre autorizado puede precargarse desde el token, pero el backend permite guardar el valor capturado en el formulario.

## 2. Inicio de sesión empresarial

- **URL:** `/`.
- Primero se captura el folio empresarial; para token `USADO` aparece el formulario de usuario y contraseña.
- Usuario: 4 a 80 caracteres; solo letras minúsculas, números, punto, guion y guion bajo al crear cuenta.
- Contraseña: mínimo 8 caracteres. Se guarda como hash con salt; no se consulta ni muestra posteriormente.
- Credenciales inválidas, cuenta suspendida o cuenta no encontrada: “Credenciales incorrectas”.
- La sesión de gestión empresarial dura **8 horas** y se conserva en `sesiones_empresa`.
- **Cerrar sesión** elimina el token del navegador; el registro de sesión puede permanecer en base hasta su expiración.
- Recuperación de contraseña por empresa: **NO IMPLEMENTADO ACTUALMENTE.** El restablecimiento está reservado a Administración.
- Si empresa/folio está suspendido, no se puede llegar al inicio empresarial por el flujo normal; si una cuenta está desactivada, el acceso devuelve credenciales incorrectas.

## 3. Portal empresarial y navegación

### `/empresa-requisitos.html` — Portal empresarial

Muestra nombre de empresa, “Cuenta empresarial activada”, “Perfil vigente”, botón **Cerrar sesión**, tarjetas de pasos y dos accesos: **Ver requisitos y formatos** / **Continuar a colaboradores**.

Las tarjetas son informativas: solo Requisitos tiene botón propio. El botón Continuar lleva a `/empresa-panel.html`. No hay KPIs numéricos, alertas individuales, filtros, paginación ni exportación en este portal.

### `/documentos.html?origen=empresa` — Requisitos y formatos

Se accede desde Requisitos. Es material de consulta/descarga de documentos aplicables. La empresa no carga documentos desde este portal. La disponibilidad exacta de cada enlace depende de los archivos publicados en `public/docs`.

### `/empresa-panel.html` — Personas registradas

Muestra tabla completa de colaboradores de la empresa y botones **Requisitos**, **+ Registrar persona** y **Salir**. En escritorio/tablet no usa scroll horizontal; en móvil la tabla permite desplazamiento horizontal.

## 4. Perfil de empresa

No existe pantalla empresarial para consultar o editar razón social, representante, teléfonos, correos, dirección, vigencia o actividad después del registro.

| Campo | Registro inicial | Consulta/edición posterior por empresa |
| --- | --- | --- |
| Nombre, razón social, representante | Obligatorio | NO IMPLEMENTADO ACTUALMENTE |
| Teléfonos y correos | Obligatorios | NO IMPLEMENTADO ACTUALMENTE |
| Dirección y actividad | Obligatorios | NO IMPLEMENTADO ACTUALMENTE |
| Folio empresarial | Se usa en acceso | Se conserva en sesión; no hay ficha de perfil visible |
| Vigencia/estado | Control interno | No hay ficha visible para empresa |

## 5. Cuentas autorizadas

La interfaz HTML conserva un modal denominado “Administradores autorizados”, pero el JavaScript actual lo elimina al cargar. Las rutas `/empresa-cuentas`, `POST /empresa-cuentas` y cambio de estado devuelven explícitamente `403` con el mensaje “La gestión de cuentas está disponible únicamente para el administrador del sistema”.

Por tanto, para empresas: crear, editar, suspender, reactivar y restablecer contraseñas de otras cuentas es **NO IMPLEMENTADO ACTUALMENTE**. Administración interna gestiona las cuentas autorizadas. Una cuenta empresarial activa puede registrar, consultar, suspender/reactivar colaboradores de su misma empresa y descargar constancias disponibles.

## 6. Registro de colaboradores

En `/empresa-panel.html`, **+ Registrar persona** abre un modal con:

| Campo | Obligatorio | Validación backend |
| --- | ---: | --- |
| Nombres | Sí | No vacío |
| Apellido paterno | Sí | No vacío |
| Apellido materno | No | Se guarda nulo si está vacío |
| Puesto | Sí | No vacío |
| Teléfono | Sí | No vacío; no hay patrón numérico adicional |
| Correo | Sí | No vacío; el frontend usa `type=email`, backend no aplica patrón adicional |

La empresa debe tener sesión válida, activa y vinculada a su empresa. El servidor genera automáticamente el folio `TIA-P-` más 10 caracteres hexadecimales, crea usuario y expediente, y registra `COLABORADOR_REGISTRADO` con actor empresarial, empresa, persona, folio, nombre, puesto y correo.

No hay comprobación explícita de correo, nombre o teléfono duplicado; el folio tiene generación criptográfica, pero no hay reintento explícito ante una colisión excepcional. Mensajes: “Completa todos los campos obligatorios”, “La sesión expiró” o “No fue posible guardar a la persona”.

## 7. Folio y acceso del colaborador

Al guardar, el modal muestra “Persona registrada” y el folio personal para entregarlo al colaborador. La empresa puede copiarlo visualmente, pero no hay botón dedicado de copiar, regenerar, reenviar o cambiar folio.

El colaborador entra en `/` con su folio. El acceso está ligado al expediente y se audita. Se conserva una sesión personal activa; los dispositivos se registran para trazabilidad y se mantienen hasta tres activos, reemplazando el menos usado al registrar un cuarto. La empresa puede suspender o reactivar el acceso desde su tabla, pero eso no es una baja formal.

## 8. Tokens para colaboradores

**NO EXISTEN TOKENS EMPRESARIALES PARA CADA COLABORADOR.** El mecanismo para el curso es el folio personal automático `TIA-P-...`. No hay generación masiva, vigencia individual, cancelación, regeneración o reenvío de tokens de colaboradores.

## 9. Seguimiento en la tabla empresarial

Columnas: Folio personal, Nombre, Puesto, Teléfono, Correo, Avance, Constancia y Acciones. No hay buscador, filtros, ordenamiento, paginación, exportación, indicador de intentos, calificación, fechas, carta ni botones de fotografía/examen para la empresa.

| Lo que ve la empresa | Regla |
| --- | --- |
| `n% completado` | Progreso agregado de videos, limitado a 100%. |
| Acceso suspendido | La empresa suspendió al colaborador; no puede entrar. |
| Curso concluido | Examen aprobado y fotografía `APROBADA`; permite PDF. |
| Fotografía pendiente | Examen aprobado, sin estado final de foto. |
| Fotografía en revisión | Foto `PENDIENTE`; constancia pendiente de validación. |
| Fotografía rechazada | Debe tomar nueva fotografía. |
| Debe tomar una nueva foto | Leyenda de constancia para foto rechazada. |
| Descargar PDF | Solo si examen aprobado y fotografía aprobada. |

## 10. Proceso real del curso observado por la empresa

Orden real: `registro empresarial → alta de colaborador → inicio con folio → carta compromiso → curso/video con validación de presencia → examen → fotografía → revisión administrativa → constancia`.

| Etapa | Responsable principal | Qué desbloquea | Vista empresarial |
| --- | --- | --- | --- |
| Alta | Empresa | Folio personal | Registro con 0% de avance |
| Carta | Colaborador | Curso | Solo avance global, no documento |
| Video | Colaborador | Examen | Porcentaje de avance |
| Examen aprobado | Colaborador | Fotografía final | Fotografía pendiente |
| Fotografía enviada | Colaborador | Revisión | Fotografía en revisión |
| Foto aprobada | Administración | Constancia | Curso concluido y PDF |
| Foto rechazada | Administración/colaborador | Nueva captura o toma física | Fotografía rechazada |

Administración interna valida fotos y puede gestionar toma física; la empresa no ve la cola ni toma la fotografía desde el portal.

## 11. Fotografía

La empresa no descarga ni aprueba fotografías. Puede inferir el resultado por el estado. Tras tres rechazos, el sistema crea solicitud de toma física, notifica por correo a la empresa cuando el SMTP está disponible y el colaborador debe acudir al módulo TIA. El portal empresarial muestra “Fotografía rechazada”/“Debe tomar una nueva foto”; no muestra el número de rechazos ni el estado detallado de la toma física.

## 12. Examen

El examen se habilita al completar el curso. Se requieren al menos 15 preguntas activas; las preguntas y opciones se aleatorizan por intento. El examen guarda intentos y respuestas aprobadas para auditoría. La calificación mínima y reglas exactas se determinan en el backend del examen; la tabla empresarial actual no muestra calificación, intentos, respuestas ni permite reintentar, descargar o intervenir en el examen. **NO CONFIRMADO EN CÓDIGO para este manual:** porcentaje mínimo exacto y límite total de intentos, porque no forman parte del portal empresarial.

## 13. Constancias

Se genera/permite descargar cuando `aprobado=1`, existe fotografía y `foto_estatus='APROBADA'`. La empresa pulsa **Descargar PDF**; ruta `GET /empresa-personas/:id/constancia`; formato real PDF, nombre `constancia-{folio}.pdf`.

Incluye nombre, empresa, curso, folio, fecha, QR y enlace de validación. Si no está lista: “La constancia estará disponible después de aprobar la fotografía”. La descarga queda auditada como `CONSTANCIA_DESCARGADA` con actor empresa, persona y folio. El colaborador también puede descargar su propia constancia desde su flujo final.

## 14. Búsqueda, filtros, tablas y exportaciones

| Pantalla | Búsqueda/filtros/paginación | Exportación |
| --- | --- | --- |
| Portal empresarial | No aplica | No aplica |
| Requisitos | No confirmado en código para filtros | Descargas de documentos disponibles según cada enlace |
| Personas registradas | No buscador, filtro, ordenamiento ni paginación | Solo PDF individual de constancia disponible |

No existe exportación empresarial a Excel/CSV/PDF masivo. Si un botón visible de “Administradores autorizados” aparece por caché/HTML, su función está deshabilitada por JavaScript y backend.

## 15. Estados

| Estado | Dónde aparece | Significado | Quién lo cambia | Siguiente estado |
| --- | --- | --- | --- | --- |
| ACTIVO | Folio empresarial | Disponible para registro inicial | Administración | CONFIGURANDO/USADO/VENCIDO/SUSPENDIDO |
| CONFIGURANDO | Token | Empresa registrada, falta cuenta | Empresa | USADO |
| USADO | Token | Cuenta creada | Sistema | Suspensión/reactivación interna |
| VENCIDO | Token | Caducidad superada | Sistema | No definido públicamente |
| Cuenta activa/suspendida | Cuenta empresarial | Puede/no puede iniciar sesión | Administración | Activa/suspendida |
| Registrado/progreso | Tabla colaborador | Curso sin aprobar | Colaborador | Foto pendiente tras aprobar |
| Fotografía pendiente | Tabla | Aprobó examen; falta carga | Colaborador | En revisión |
| En revisión | Tabla | Foto enviada | Administración | Aprobada/rechazada |
| Rechazada | Tabla | Debe recapturar o ir a toma física | Administración/colaborador | Pendiente/en revisión/aprobada |
| Curso concluido | Tabla | Examen y foto aprobados | Administración | Final |
| Acceso suspendido | Tabla | Perfil inhabilitado, no baja formal | Empresa | Reactivado |

## 16. Errores y casos especiales

| Situación | Mensaje real/principal | Qué debe hacer empresa |
| --- | --- | --- |
| Token inexistente | “Folio no encontrado” | Solicitar token válido a Administración |
| Token vencido | “Este folio ha caducado” | Solicitar nuevo token |
| Token no activo | “Este folio no se encuentra activo” | Solicitar revisión a Administración |
| Sesión expirada | “Sesión expirada” / “La sesión expiró” | Ingresar nuevamente con folio, usuario y contraseña |
| Usuario existente | “El nombre de usuario ya existe” | Elegir otro usuario |
| Datos incompletos | “Completa todos los campos obligatorios” | Completar formulario |
| Colaborador no localizado | “Colaborador no encontrado” | Confirmar empresa y registro |
| Ya suspendido/no suspendido | Mensaje equivalente | Recargar tabla y usar acción opuesta |
| Constancia pendiente | “La constancia estará disponible después de aprobar la fotografía” | Esperar revisión o atender rechazo |
| Correo de suspensión no enviado | Advertencia, pero suspensión aplicada | Confirmar datos de correo con módulo TIA |

## 17. Seguridad, separación y permisos

Una sesión empresarial solo consulta y modifica filas cuyo `empresa_id` coincide con su sesión. Una empresa no puede consultar colaboradores ni descargar constancias de otra empresa. La empresa no puede validar fotos, cambiar preguntas, editar perfil posterior, gestionar sus propios usuarios autorizados, generar tokens empresariales, consultar auditoría interna ni ver documentos de otros colaboradores.

La suspensión elimina las sesiones personales del colaborador y registra auditoría. No elimina avance, examen o documentos; reactivación los conserva. Las contraseñas se almacenan como hash/salt. La sesión empresarial vence en ocho horas.

## 18. Auditoría de actividad empresarial

| Acción | Evento | Datos registrados |
| --- | --- | --- |
| Registro de empresa | `EMPRESA_REGISTRADA` | Empresa, folio de token, razón social y representante |
| Configurar primera cuenta | `CUENTA_EMPRESA_CONFIGURADA` | Actor, empresa, usuario |
| Inicio de sesión | `INICIO_SESION_EMPRESA` | Actor, empresa, IP, navegador, fecha/hora |
| Registrar colaborador | `COLABORADOR_REGISTRADO` | Actor, empresa, persona, folio, nombre, puesto, correo |
| Suspender colaborador | `COLABORADOR_SUSPENDIDO` | Actor, empresa, persona, folio, motivo operativo |
| Reactivar colaborador | `COLABORADOR_REACTIVADO` | Actor, empresa, persona, folio |
| Descargar constancia | `CONSTANCIA_DESCARGADA` | Actor, persona, folio, fecha/hora |

## 19. Caso completo

| Paso | Actor | Acción | Antes → después | Auditoría | Qué ve empresa |
| ---: | --- | --- | --- | --- | --- |
| 1 | Administración | Genera token | Nuevo → ACTIVO | Token creado | Recibe folio |
| 2 | Empresa | Valida token | ACTIVO → sesión temporal | No aplica | Registro |
| 3 | Empresa | Registra datos | ACTIVO → CONFIGURANDO | EMPRESA_REGISTRADA | Crear cuenta |
| 4 | Empresa | Crea cuenta | CONFIGURANDO → USADO | CUENTA_EMPRESA_CONFIGURADA | Portal/requisitos |
| 5 | Empresa | Registra colaborador | Sin expediente → registrado | COLABORADOR_REGISTRADO | Folio personal |
| 6 | Colaborador | Realiza carta/video/examen | Progreso → aprobado | Eventos de curso/examen | Avance/estado |
| 7 | Colaborador | Envía foto | Pendiente → en revisión | FOTOGRAFIA_ENVIADA | En revisión |
| 8 | Administración | Aprueba foto | En revisión → aprobada | FOTOGRAFIA_APROBADA | Curso concluido/PDF |
| 9 | Empresa | Descarga PDF | Disponible → disponible | CONSTANCIA_DESCARGADA | Archivo PDF |

## 20. Inventario de capturas para el manual

| # | Pantalla/ruta | Debe verse | Modales/mensajes |
| ---: | --- | --- | --- |
| 1 | `/` | Captura de token empresarial | Token inválido, vencido, no activo |
| 2 | `/` credenciales | Folio, usuario, contraseña | Credenciales incorrectas |
| 3 | `/empresa.html` | Todos los campos de registro | Empresa registrada/error de validación |
| 4 | `/cuenta.html` | Usuario, contraseña, confirmación | Contraseñas no coinciden, cuenta activada |
| 5 | `/empresa-requisitos.html` | Cuatro pasos, requisitos, continuar, salir | No aplica |
| 6 | `/documentos.html?origen=empresa` | Tabla de requisitos y descargas | Enlaces de descarga |
| 7 | `/empresa-panel.html` vacío | Encabezado, acciones, mensaje sin personas | No aplica |
| 8 | Modal Registrar persona | Seis campos y botones | Campos obligatorios/error/folio generado |
| 9 | `/empresa-panel.html` con progreso | Tabla con avance | No aplica |
| 10 | Estado foto pendiente/revisión/rechazada | Cada leyenda y constancia no disponible | No aplica |
| 11 | Modal Suspender acceso | Aclaración de que no es baja formal | Confirmación y éxito/advertencia de correo |
| 12 | Modal Reactivar acceso | Conservación de avance/documentos | Confirmación y éxito |
| 13 | Estado concluido | Botón Descargar PDF | Archivo PDF de constancia |

## A–G. Resumen requerido

**A. Flujo empresarial completo:** ver secciones 1 y 19.  
**B. Matriz de permisos:** ver secciones 5 y 17.  
**C. Tabla de estados:** ver sección 15.  
**D. Tabla de errores:** ver sección 16.  
**E. Eventos de auditoría:** ver sección 18.  
**F. Inventario de capturas:** ver sección 20.  
**G. Funciones visibles pero no implementadas:** gestión empresarial de administradores autorizados; edición posterior de perfil; filtros/exportación masiva; descarga empresarial de carta, examen o fotografía; regeneración/reenvío de folio; recuperación de contraseña.
