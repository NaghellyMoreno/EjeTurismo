# Aplicativo 2 – Eje Turismo

> Fuente: *Proyecto Final – Asignación y descripción de los aplicativos*
> Ingeniería de Software 3 · Ingeniería de Sistemas y Computación · Universidad de Caldas

---

## 1. Descripción general

Facilitar la promoción, consulta y descubrimiento de destinos, atractivos, servicios y experiencias turísticas de **Manizales y los municipios del Eje Cafetero**.

## 2. Necesidad o problema que resuelve

La información turística suele estar dispersa en redes sociales, páginas y contactos individuales. El visitante necesita encontrar información organizada y confiable sobre lugares, actividades, servicios, ubicación y formas de contacto.

## 3. Usuarios y responsabilidades

| Rol | Responsabilidades |
|---|---|
| **Administrador de la plataforma** | Gestiona municipios, categorías, contenidos, publicaciones y usuarios autorizados. |
| **Prestador u operador turístico** | Registra o actualiza la información de su establecimiento, servicio o experiencia, sujeto a validación. |
| **Visitante o turista** | Explora destinos, consulta atractivos, revisa fotografías, ubicación, horarios y datos de contacto. |

## 4. Módulos y funcionalidades principales

- **Municipios y destinos:** Información general de municipios, zonas y destinos turísticos.
- **Atractivos turísticos:** Fichas de sitios naturales, culturales, históricos y patrimoniales.
- **Establecimientos y alojamientos:** Hoteles, fincas cafeteras, alojamientos rurales y otros servicios turísticos.
- **Gastronomía y restaurantes:** Directorio de restaurantes, cafés y experiencias gastronómicas.
- **Rutas y experiencias:** Recorridos, actividades, guías, operadores y experiencias disponibles.
- **Eventos:** Agenda de festividades, actividades culturales, ferias y eventos turísticos.
- **Galería y georreferenciación:** Fotografías, mapas, ubicación y datos para orientar al visitante.
- **Contacto y solicitudes:** Canales de contacto y formularios o conversaciones para solicitar información o manifestar interés en una reserva.

## 5. Flujo general de operación

1. El administrador o prestador autorizado registra la información del destino o servicio.
2. La plataforma organiza el contenido por municipio, categoría y tipo de experiencia.
3. El visitante consulta opciones mediante Telegram y revisa sus detalles.
4. El visitante puede abrir la ubicación, consultar horarios y contactar al prestador.
5. La plataforma registra solicitudes de información o interés cuando se habilite esta función.

## 6. Alcance y límites del aplicativo

Eje Turismo prioriza la **promoción y el descubrimiento** de la oferta turística.

- **No** es obligatorio construir un motor completo de reservas, pagos o administración hotelera.
- Si se incorporan solicitudes de reserva, estas pueden remitirse al prestador para su confirmación.

---

## 7. Orientaciones generales que aplican al proyecto

### 7.1 Telegram como interfaz principal
- Telegram es el canal principal de interacción mediante un **bot**: comandos, botones, menús, formularios conversacionales, mensajes, fotografías, documentos y notificaciones.
- Cuando se requiera una interfaz visual más amplia o compleja, se puede incorporar una **Telegram Mini App**, siempre integrada al flujo de Telegram.

### 7.2 Responsabilidades del backend
- El backend concentra la lógica de negocio, validaciones, reglas de operación, autenticación, autorización, persistencia de datos y comunicación con servicios externos.
- No se deben confiar controles críticos únicamente a la interfaz del bot.
- Cada operación debe verificar el usuario, su rol, el negocio al que pertenece y los permisos correspondientes.
- La solución debe funcionar de manera independiente; las integraciones con otros aplicativos son complementarias, no requisito.

### 7.3 Criterios comunes de diseño
- Separación de la información de cada negocio o establecimiento.
- Gestión de usuarios, roles y permisos según las responsabilidades reales.
- Validación de datos y prevención de registros duplicados o inconsistentes.
- Registro de fechas, estados y responsables para facilitar la trazabilidad.
- Mensajes claros y confirmaciones antes de ejecutar operaciones importantes.
- Manejo de errores, cancelaciones y situaciones excepcionales.
- Reportes básicos para consultar la operación y apoyar la toma de decisiones.
- Protección de datos personales y acceso únicamente a la información autorizada.

---

## 8. Metodología: Spec-Driven Development (SDD)

El desarrollo debe partir de especificaciones claras, verificables y actualizadas, no de instrucciones generales o prompts aislados.

1. **Comprensión del problema:** usuarios, necesidades, contexto, alcance y restricciones.
2. **Especificación funcional:** módulos, actores, roles, historias de usuario, reglas de negocio y criterios de aceptación.
3. **Especificación técnica:** arquitectura, componentes, modelo de datos, servicios, integraciones y tecnologías.
4. **Planificación:** tareas e incrementos verificables, priorizando funcionalidades esenciales.
5. **Desarrollo guiado por especificaciones:** contrastar continuamente el resultado con los requisitos aprobados.
6. **Pruebas y validación:** criterios de aceptación, permisos, flujos principales y manejo de errores.
7. **Documentación y demostración:** entregar documentación y demostrar el aplicativo con escenarios representativos.

## 9. Entregables individuales

- [ ] Documento de especificación funcional y criterios de aceptación.
- [ ] Documento de especificación técnica y arquitectura propuesta.
- [ ] Modelo de datos y descripción de los componentes principales.
- [ ] Evidencias del uso de los agentes de IA creados en el primer proyecto.
- [ ] Código fuente organizado y ejecutable del aplicativo.
- [ ] Plan y evidencias de pruebas funcionales.
- [ ] Manual breve de uso y documentación técnica básica.
- [ ] Demostración funcional de los principales flujos del aplicativo.

## 10. Criterios generales de valoración

- Calidad, claridad y trazabilidad de las especificaciones.
- Correspondencia entre requisitos, implementación y criterios de aceptación.
- Funcionamiento de los procesos principales y validación de reglas de negocio.
- Calidad técnica, organización y mantenibilidad del código.
- Uso crítico, documentado y verificable de los agentes de IA.
- Pruebas, documentación y calidad de la demostración final.
---


