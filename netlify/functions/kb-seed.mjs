/* ============================================================
   AppXpand · Contenido base del Centro de conocimiento
   ------------------------------------------------------------
   Se carga solo la primera vez (o con el botón «Cargar contenido
   base» de la pestaña Equipo, que únicamente rellena las secciones
   que estén vacías). Después todo se edita desde la plataforma:
   este archivo no se vuelve a leer para mostrar nada.

   Formato del texto de cada entrada:
     línea en blanco       → nuevo párrafo
     «- » al empezar       → lista
     «1. » al empezar      → lista numerada
     «| a | b |»           → tabla (la primera fila es la cabecera)
   ============================================================ */
const E = (id, section, category, question, answer, keywords = '') =>
  ({ id: 'seed-' + id, section, category, question, answer, keywords });

/* ---------- Precios de páginas web (catálogo comercial 2026) ----------
   Van al principio de «Precios y packs». También se aplican una sola vez a los paneles que
   ya tenían contenido (ver KB_PATCHES al final y applyKbPatches en api.mjs). */
const WEB_PRICES = [
  E('pre-web-0', 'precios', '', 'Páginas web · precios (pago único)',
`| Web | Precio | Qué incluye |
| Web Básico | 337 € | Landing page |
| Pack Inicial | 649 € | Web corporativa de hasta 3 pestañas |
| Pack Pro | 1.189 € | Hasta 6 pestañas, asistente de IA y métricas |

- Pago único por proyecto.
- El mantenimiento mensual es opcional y se contrata aparte.
- Los dominios y servicios de terceros no están incluidos salvo que se indique.
- El posicionamiento local suele tardar entre 1 y 3 meses en notarse: conviene decirlo al cliente desde el principio.`,
    'precio web, cuánto cuesta una web, página web, tarifa, landing, web básico, pack inicial, pack pro, 337, 649, 1189, 1.189, pago único, presupuesto'),

  E('pre-web-1', 'precios', '', 'Web Básico · 337 € (pago único)',
`Landing page optimizada con un único objetivo: que el cliente contacte.

- Llamada a la acción (CTA) clara y visible.
- Formulario de contacto con aviso de nueva solicitud por email.
- Botones de llamada y WhatsApp en móvil.
- Mapa con la ubicación y horarios.
- Diseño adaptado a móvil, tablet y ordenador.
- Carga rápida y SEO local básico.
- Publicación y puesta en marcha incluidas.`,
    'precio web, landing, landing page, web básico, 337, una página, sencilla, barata, económica, whatsapp, formulario, mapa, pago único'),

  E('pre-web-2', 'precios', '', 'Pack Inicial · 649 € (pago único)',
`Web corporativa. Incluye todo lo de Web Básico y además:

- Web corporativa de hasta 3 pestañas (inicio, servicios, contacto).
- Textos legales RGPD: aviso legal, privacidad y cookies.
- Banner de cookies conforme a la normativa.
- Optimización SEO: títulos, descripciones, estructura y palabras clave locales.
- Alta en Google Search Console y envío del mapa del sitio.
- Alta y optimización básica de la ficha de Google.
- Textos de la web redactados con enfoque comercial.`,
    'precio web, web corporativa, pack inicial, 649, tres pestañas, 3 pestañas, rgpd, legal, cookies, seo, search console, ficha de google, google maps, pago único'),

  E('pre-web-3', 'precios', '', 'Pack Pro · 1.189 € (pago único)',
`Web completa con asistente de IA y métricas. Incluye todo lo de Pack Inicial y además:

- Asistente de IA 24 horas en la web: responde dudas y recoge contactos.
- Métricas de seguimiento mensuales: visitas, llamadas, formularios y rutas.
- Informe mensual claro, sin tecnicismos.
- Ficha de Google optimizada a fondo, con estudio de la competencia.
- Tarjeta de reseñas con QR para el mostrador.
- Hasta 6 pestañas en la web.
- Formación de 30 minutos para gestionar contactos y mensajes.`,
    'precio web, pack pro, 1189, 1.189, web completa, asistente ia, inteligencia artificial, chatbot, métricas, informe, reseñas, qr, seis pestañas, 6 pestañas, formación, pago único')
];

/* ---------- Guion de captación (leads) · va ANTES del paso 1 del proceso comercial ---------- */
const CAPTACION = [
  E('cap-1', 'cierre', '', "Dónde buscar clientes y a quién llamar primero",
    "Buscamos negocios locales que ya tienen clientes pero se ven mal en Google. Abre Google Maps, busca un tipo de negocio de tu zona (por ejemplo \"peluquería Albacete\") y revisa las fichas una a una.\n\nSeñales de un buen candidato:\n- Menos de 20 reseñas o nota por debajo de 4,3.\n- Pocas fotos, sin servicios o con horarios antiguos.\n- Sin web, o con una web lenta que no se ve bien en el móvil.\n- Negocio recién abierto: es el mejor momento para el Paquete lanzadera.\n- Competidores cercanos con una ficha claramente mejor (será tu argumento).\n\nOrden de prioridad:\n1. Negocios nuevos.\n2. Negocios con ficha a medias pero con movimiento (reseñas recientes).\n3. Negocios con web antigua.\n\nRegistra cada negocio que contactes en el panel: nombre, contacto, tipo, el problema que has visto y la fecha del próximo seguimiento. Sin registro no hay seguimiento.",
    "leads, captación, buscar clientes, prospectar, google maps, candidatos, a quién llamar"),

  E('cap-2', 'cierre', '', "Mini-revisión de 10 minutos (antes de contactar)",
    "Antes del primer contacto, mira estas 5 cosas y apunta datos concretos:\n\n1. Ficha de Google: número de reseñas y nota, fotos, categorías, servicios, horario y descripción.\n2. Dos o tres competidores de la zona: las mismas cifras.\n3. Web: ¿existe?, ¿se ve bien en el móvil?, ¿tiene botón de llamar o WhatsApp?, ¿muestra precios?\n4. Reseñas recientes: ¿responde el dueño?, ¿cuándo fue la última?\n5. Busca \"[su servicio] + [su ciudad]\": ¿aparece? ¿En qué puesto?\n\nResultado: 3 hallazgos concretos con cifras, por ejemplo \"tenéis 12 reseñas y el negocio de al lado 85\". Son los datos que usarás en el primer contacto.\n\nNo inventes datos ni prometas posiciones en Google.",
    "revisión, revisión gratuita, checklist, auditoría, análisis, preparar contacto, hallazgos"),

  E('cap-3', 'cierre', '', "Guion 1 · Visita en persona (la más eficaz)",
    "Cuándo ir: fuera de las horas punta (no a mediodía en un bar ni con cola).\n\n1. Saludo y motivo corto: \"Hola, soy [nombre] de AppXpand. Trabajamos con negocios de la zona para que los encuentren mejor en Google. ¿Hablo con el responsable?\"\n2. Dato concreto: \"He mirado vuestra ficha en Google y he visto [hallazgo], y que [competidor] tiene [cifra]. Me ha parecido una pena porque se nota que el negocio funciona.\"\n3. Propuesta: \"Te hacemos una revisión gratuita de cómo te ven hoy los clientes, sin compromiso. Respondemos en menos de 24 horas con lo que hemos visto. ¿Me dejas tu nombre y un teléfono o email?\"\n4. Cierre: apunta nombre del negocio, ciudad y contacto, y confirma el siguiente paso: \"Mañana te escribimos con lo que hemos visto.\"\n\nSi no está el responsable: pregunta cuándo puedes volver y apunta el nombre de quien te atiende.",
    "visita, en persona, presencial, entrar al negocio, primer contacto, guion, puerta fría"),

  E('cap-4', 'cierre', '', "Guion 2 · Llamada de teléfono",
    "1. Presentación y permiso: \"Hola, ¿hablo con [nombre / el responsable de (negocio)]? Soy [nombre] de AppXpand, ¿tienes un minuto?\"\n   Si no puede: \"¿Cuándo te viene mejor que te llame?\" y apúntalo.\n2. Gancho con dato: \"Te llamo porque he visto la ficha de [negocio] en Google y he notado [hallazgo]. Ayudamos a negocios de la zona a que los encuentren y les llamen más desde Google.\"\n3. Propuesta: \"Lo primero que hacemos es una revisión gratuita: miramos tu ficha, tu web y tus reseñas frente a los negocios de tu zona y te contamos qué falla. ¿Te la preparamos?\"\n4. Cierre: \"Perfecto, ¿me dices tu email o tu WhatsApp? En menos de 24 horas te llega lo que hemos visto.\"\n\nConsejos: máximo 2 minutos, habla despacio y no leas el guion de corrido. Si dice que no, agradece y pregunta si puedes volver a escribirle más adelante.",
    "llamada, teléfono, llamar, primer contacto, guion, llamada en frío"),

  E('cap-5', 'cierre', '', "Guion 3 · Mensaje (WhatsApp o Instagram)",
    "Mensaje base (cámbialo para cada negocio, nunca mandes el mismo a todos):\n\n\"Hola [nombre], soy [tu nombre] de AppXpand. He visto la ficha de [negocio] en Google y he notado que [hallazgo concreto]. Hacemos revisiones gratuitas de cómo te ven tus clientes en Google, sin compromiso. ¿Te la preparo? Si no te interesa, dímelo y no te escribo más.\"\n\nReglas:\n- Un mensaje por negocio, corto y personalizado. Nada de envíos masivos.\n- Siempre que se pueda, mejor visita o llamada antes que mensaje.\n- Ofrece siempre la opción de no recibir más mensajes y respétala.",
    "mensaje, whatsapp, instagram, dm, primer contacto, escribir, plantilla"),

  E('cap-6', 'cierre', '', "Guion 4 · Seguimiento (si no contestan)",
    "- Día 2-3: \"Hola [nombre], te escribí hace unos días sobre la ficha de [negocio]. ¿Te la preparo? Son 10 minutos y es gratis.\"\n- Día 7: aporta algo nuevo, no repitas: \"He visto que [competidor] acaba de subir fotos y reseñas nuevas. Si quieres te cuento cómo está tu ficha en comparación.\"\n- Día 14 (último): \"No te molesto más. Si algún día quieres saber cómo te ven en Google, aquí estoy.\"\n\nMáximo 3 intentos. Después, apúntalo en el panel y retómalo dentro de 2-3 meses.\n\nCuando entregues la revisión: no la mandes sin más. Llama para explicarla, enseña los 3 hallazgos y propón el paquete que encaje:\n- Negocio nuevo: Paquete lanzadera.\n- Tiene web pero la ficha está floja: optimización del perfil de Google.\n- Sin web: Web Básico o Pack Inicial.",
    "seguimiento, no contesta, recordatorio, insistir, segundo mensaje, revisión entregada, siguiente paso"),

  E('cap-7', 'cierre', '', "Respuestas rápidas al primer contacto",
    "| Si dicen | Responde |\n| \"No tengo tiempo\" | \"Entiendo, por eso lo hacemos nosotros: solo necesito el nombre del negocio. ¿Te lo mando por WhatsApp?\" |\n| \"Ya tengo quien me lo lleva\" | \"Perfecto. La revisión no compromete a nada y te sirve para comparar lo que tienes con lo que se ve en Google. ¿Te la envío igualmente?\" |\n| \"Mándame información\" | \"Claro. Para que no sea genérica te preparo la revisión de tu negocio. ¿Me das tu email o WhatsApp?\" |\n| \"No me interesa\" | \"Sin problema, gracias por tu tiempo. ¿Puedo escribirte más adelante?\" Si dice que no, anótalo y no insistas. |\n| \"¿Cuánto cuesta?\" | \"La revisión es gratuita. Después, según lo que necesites, hay opciones desde 337 € para la web (pago único). Te lo cuento cuando veamos tu caso.\" |\n| \"¿Me aseguras salir primero en Google?\" | \"Nadie puede garantizar una posición. Lo que hacemos es dejar tu ficha, tu web y tus reseñas bien montadas y medir cómo evoluciona. Suele notarse entre 1 y 3 meses.\" |",
    "no tengo tiempo, ya tengo, mándame información, no me interesa, cuánto cuesta, garantía, primeros en google, rechazo, primer contacto"),

  E('cap-8', 'cierre', '', "Normas de contacto con clientes potenciales",
    "- Prioriza la visita y la llamada. Evita los envíos masivos de WhatsApp, email o mensajes directos: la normativa española restringe las comunicaciones comerciales electrónicas no solicitadas.\n- Preséntate siempre con tu nombre y AppXpand, y di de dónde has sacado el contacto (su ficha pública de Google).\n- Usa solo datos públicos del negocio.\n- Si te dicen que no, no vuelvas a contactar y anótalo en el panel.\n- No prometas posiciones ni resultados en Google.\n- Ante cualquier duda, consulta con la administración antes de enviar nada.",
    "normas, normativa, legal, spam, protección de datos, consentimiento, rgpd, lssi, contactar, permiso")
];

export const KB_SEED = [
  /* ---------- 1 · Qué vendemos ---------- */
  E('srv-1', 'servicios', '', '¿Qué es AppXpand?',
`AppXpand es una empresa especializada en el desarrollo de soluciones digitales para negocios y profesionales. Ayudamos a empresas a mejorar su presencia online, optimizar sus procesos y disponer de herramientas digitales adaptadas a sus necesidades.

No vendemos simplemente páginas web: desarrollamos soluciones que ayudan a los negocios a trabajar mejor, transmitir profesionalidad y captar nuevas oportunidades.`,
    'empresa, quiénes somos, presentación, qué hacemos, a qué nos dedicamos'),

  E('srv-2', 'servicios', '', '¿Qué servicios ofrecemos?',
`- Desarrollo de páginas web corporativas.
- Desarrollo de tiendas online y ecommerce.
- Diseño y desarrollo de funcionalidades personalizadas.
- Integraciones y automatizaciones.
- Optimización SEO básica.
- Mantenimiento y soporte técnico.
- Mejoras y ampliaciones de proyectos existentes.`,
    'servicios, catálogo, web, tienda online, ecommerce, seo, mantenimiento, automatizaciones, integraciones'),

  E('srv-3', 'servicios', '', '¿Qué nos diferencia?',
`- Soluciones adaptadas a cada negocio.
- Trato directo y personalizado.
- Posibilidad de ampliar los proyectos en el futuro.
- Mantenimiento para evitar que el cliente tenga que preocuparse de cuestiones técnicas.
- Diferentes presupuestos y modalidades según las necesidades.`,
    'diferencia, ventajas, competencia, por qué nosotros, valor, argumentos'),

  /* ---------- 3 · Objeciones: precio ---------- */
  E('obj-1', 'objeciones', 'precio', 'Me parece demasiado caro',
`Entiendo perfectamente que quieras valorar la inversión. Lo importante es que no estás pagando únicamente por una página web, sino por una solución diseñada para tu negocio, con una estructura profesional y preparada para ayudarte a mejorar tu presencia digital.

Podemos estudiar qué necesitas realmente y encontrar una opción que se adapte mejor a tu presupuesto.`,
    'caro, es caro, muy caro, costoso, mucho dinero, precio alto, elevado, no me compensa, es mucho, me parece mucho'),

  E('obj-2', 'objeciones', 'precio', 'He encontrado alguien que me lo hace más barato',
`¡Perfecto! Es importante comparar presupuestos. Lo que te recomendaría es que también compares qué incluye cada uno: funcionalidades, diseño, soporte, mantenimiento, posibilidades de ampliación y atención posterior.

En AppXpand buscamos que el proyecto no termine cuando se publica la web, sino que puedas seguir contando con nosotros.`,
    'barato, más barato, caro, competencia, otro presupuesto, más económico, mejor precio, comparar, otra empresa, otro proveedor'),

  E('obj-3', 'objeciones', 'precio', 'Ahora mismo no tengo presupuesto',
`Lo entiendo. No queremos que hagas una inversión que no encaje con tu situación actual. Podemos valorar una solución más sencilla para empezar y dejar previstas futuras ampliaciones cuando el negocio esté preparado.`,
    'sin dinero, no puedo pagar, no me llega, no tengo dinero, caro, crisis, ahora no, más adelante, presupuesto'),

  E('obj-4', 'objeciones', 'precio', '¿No podéis hacerme un descuento?',
`Podemos estudiar las condiciones del proyecto. Dependiendo del servicio contratado y de su alcance, tenemos cierto margen para ofrecer condiciones especiales.

Déjame revisar qué opciones podemos ofrecerte.`,
    'rebaja, oferta, mejor precio, regatear, promoción, descuento, caro, precio'),

  /* ---------- 3 · Objeciones: necesidad ---------- */
  E('obj-5', 'objeciones', 'necesidad', 'Ya tengo Instagram, no necesito una web',
`Instagram es una herramienta estupenda para darte visibilidad, pero una página web te permite tener un espacio propio donde presentar tus servicios, mostrar tus trabajos, explicar tus tarifas y facilitar que los clientes contacten contigo.

No tienen por qué competir: pueden complementarse.`,
    'redes sociales, facebook, tiktok, rrss, instagram, ya tengo redes'),

  E('obj-6', 'objeciones', 'necesidad', 'Mi negocio funciona perfectamente sin página web',
`¡Y eso es estupendo! No buscamos cambiar algo que ya funciona. La cuestión es si podrías aprovechar nuevas oportunidades ofreciendo a tus clientes otra forma de conocerte, consultar tus servicios y contactar contigo.`,
    'no la necesito, no hace falta, funciona bien, para qué, no me hace falta, voy bien'),

  E('obj-7', 'objeciones', 'necesidad', 'Mis clientes vienen por recomendaciones',
`Las recomendaciones son muy valiosas. Pero cuando alguien recibe una recomendación, muchas veces busca el negocio en Google antes de contactar. Tener una presencia digital profesional ayuda a transmitir confianza en ese momento.`,
    'boca a boca, recomendación, recomendaciones, referencias, google, buscar en internet'),

  E('obj-8', 'objeciones', 'necesidad', 'No necesito vender por Internet',
`No todas las páginas web tienen que vender directamente. Podemos desarrollar una web corporativa para presentar tu negocio, mostrar tus servicios, generar contactos y facilitar las consultas.`,
    'no vendo online, tienda online, ecommerce, no quiero vender, vender por internet'),

  /* ---------- 3 · Objeciones: confianza y funcionamiento ---------- */
  E('obj-9', 'objeciones', 'confianza', '¿Y si después necesito modificar algo?',
`No hay problema. Los proyectos se pueden ampliar y modificar. Además, disponemos de planes de mantenimiento que incluyen horas mensuales de desarrollo en las modalidades Avanzada y Premium.`,
    'cambios, modificar, editar, actualizar, ampliar, retocar, cambiar la web, más adelante'),

  E('obj-10', 'objeciones', 'confianza', '¿Qué pasa si tengo un problema con la web?',
`Puedes contar con nosotros para recibir soporte técnico y asistencia, según las condiciones del servicio contratado.`,
    'problema, error, fallo, caída, soporte, ayuda, avería, se rompe, no funciona, garantía, no me fío'),

  E('obj-11', 'objeciones', 'confianza', '¿Cuánto tarda en estar terminada?',
`Depende del tipo de proyecto, sus funcionalidades y la información que necesitamos recibir. Antes de comenzar, establecemos un alcance y una estimación de entrega.`,
    'plazo, tiempo, entrega, cuándo, rapidez, urgencia, cuánto tarda, tarda mucho, fecha'),

  E('obj-12', 'objeciones', 'confianza', '¿Tengo que saber de informática?',
`En absoluto. Nuestro objetivo es que puedas centrarte en tu negocio. Nosotros nos encargamos de la parte técnica y te orientamos durante el proceso.`,
    'técnico, no entiendo, informática, difícil, complicado, no sé, no tengo idea, ordenadores'),

  /* ---------- 4 · Preguntas frecuentes ---------- */
  E('faq-1', 'faq', '', '¿Trabajáis con autónomos?', 'Sí, trabajamos tanto con autónomos como con empresas y profesionales.', 'autónomo, freelance, profesionales, empresas'),
  E('faq-2', 'faq', '', '¿Trabajáis fuera de Albacete?', 'Sí, podemos desarrollar proyectos para clientes de toda España.', 'ciudad, otra provincia, toda españa, remoto, online, ubicación'),
  E('faq-3', 'faq', '', '¿Las webs son personalizadas?', 'Adaptamos el diseño y las funcionalidades a las necesidades del proyecto.', 'personalizada, a medida, plantilla, diseño'),
  E('faq-4', 'faq', '', '¿Puedo tener mi propio dominio?', 'Sí, podemos trabajar con un dominio propio.', 'dominio, .com, .es, url, nombre de la web'),
  E('faq-5', 'faq', '', '¿La web funciona en móviles?', 'Sí, desarrollamos webs adaptadas a móviles, tablets y ordenadores.', 'móvil, responsive, tablet, adaptada, celular'),
  E('faq-6', 'faq', '', '¿Incluís posicionamiento en Google?', 'Todas las webs llevan SEO local básico y, desde el Pack Inicial, optimización SEO completa (títulos, descripciones, estructura, palabras clave locales y alta en Google Search Console). No se garantiza una posición concreta: el posicionamiento local suele tardar entre 1 y 3 meses en notarse.', 'seo, google, posicionar, posicionamiento, aparecer, primeros resultados, buscadores, garantía'),
  E('faq-7', 'faq', '', '¿Puedo tener una tienda online?', 'Sí, desarrollamos soluciones ecommerce.', 'tienda, ecommerce, vender online, carrito, comprar'),
  E('faq-8', 'faq', '', '¿Puedo ampliar mi web después?', 'Sí, podemos presupuestar nuevas funcionalidades y ampliaciones.', 'ampliar, ampliación, nuevas funciones, más adelante, crecer'),
  E('faq-9', 'faq', '', '¿El mantenimiento es obligatorio?', 'No debemos presentarlo como obligatorio salvo que las condiciones específicas del proyecto indiquen lo contrario.', 'mantenimiento, obligatorio, cuota, mensualidad, permanencia, tengo que pagar'),
  E('faq-10', 'faq', '', '¿Puedo contratar mantenimiento después?', 'Sí, podemos valorar la contratación de un plan para una web existente.', 'mantenimiento, web existente, ya tengo web, contratar luego'),
  E('faq-11', 'faq', '', '¿Puedo pagar por adelantado?', 'Sí, existen modalidades de prepago de mantenimiento de 3, 6 y 12 meses.', 'prepago, anticipado, pago adelantado, pack, descuento, ahorrar, pagar de una vez'),
  E('faq-12', 'faq', '', '¿Las horas de desarrollo se acumulan?', 'No, las horas se renuevan mensualmente y no son acumulables.', 'horas, desarrollo, acumulables, acumular, renuevan, mensual'),

  /* ---------- 2 · Precios y packs ---------- */
  ...WEB_PRICES,

  E('pre-lanz', 'precios', '', 'Paquete lanzadera · 330 € de alta + 29 €/mes',
`Para negocios que acaban de abrir.

- Alta: web, estudio y optimización de la ficha de Google.
- Formulario, mapa y tarjeta de reseñas.
- Mantenimiento: ajustes de SEO revisados cada 3 meses.
- Una modificación por campaña (Navidad, verano, Black Friday…).
- Cambios extra, a consulta.`,
    'precio, lanzadera, negocio nuevo, acaba de abrir, 330, 29, alta, cuota, paquete'),

  E('pre-1', 'precios', '', 'Mantenimiento Básico · 39,99 €/mes',
`- Mantenimiento técnico y actualizaciones de seguridad.
- Copias de seguridad.
- Revisiones de funcionamiento y comprobación de formularios y enlaces.
- Soporte por email y WhatsApp.
- Sin horas de desarrollo incluidas.`,
    'precio, tarifa, cuota, mensualidad, cuánto cuesta, mantenimiento, plan, básico, barato'),

  E('pre-2', 'precios', '', 'Mantenimiento Avanzado · 69,99 €/mes',
`Todo lo del plan Básico y además:

- Optimización de velocidad.
- Revisiones técnicas semanales.
- 1 hora de desarrollo al mes: pequeños cambios y mejoras funcionales.
- Actualizaciones de contenido.
- Soporte prioritario.

Es el plan más recomendado.`,
    'precio, tarifa, cuota, mensualidad, cuánto cuesta, mantenimiento, plan, avanzado'),

  E('pre-3', 'precios', '', 'Mantenimiento Premium · 117 €/mes',
`Todo lo del plan Avanzado y además:

- 3 horas de desarrollo al mes: mejoras y nuevas funcionalidades.
- Modificaciones de diseño.
- Optimización SEO periódica.
- Informe mensual de rendimiento y revisión de conversiones.
- Atención prioritaria.`,
    'precio, tarifa, cuota, mensualidad, cuánto cuesta, mantenimiento, plan, premium, completo'),

  E('pre-4', 'precios', '', 'Packs de mantenimiento anticipado',
`El cliente puede contratar mantenimiento por adelantado y beneficiarse de descuentos.

| Modalidad | 3 meses | 6 meses | 12 meses |
| Descuento | 5% | 10% | 15% |

Importes finales:

| Plan | 3 meses | 6 meses | 12 meses |
| Básico | 113,97 € | 215,95 € | 407,90 € |
| Avanzado | 199,47 € | 377,95 € | 713,90 € |
| Premium | 333,45 € | 631,80 € | 1.193,40 € |`,
    'prepago, anticipado, pago adelantado, pack, descuento, ahorrar, 3 meses, 6 meses, 12 meses, anual, trimestral, semestral'),

  E('pre-5', 'precios', '', 'Condiciones importantes',
`- Las horas de desarrollo se renuevan cada mes y no son acumulables.
- Se contabiliza el tiempo real de trabajo: no equivalen a desarrollos ilimitados.
- Las horas incluidas son para webs existentes.
- Los proyectos grandes, integraciones complejas y desarrollos que superen las horas incluidas se presupuestan aparte.
- Los packs de prepago se abonan por adelantado y sus descuentos no se acumulan con otras promociones.
- Los dominios y servicios de terceros no están incluidos salvo que se indique.
- Precios totales, IVA no desglosado.`,
    'condiciones, horas, acumulables, extras, integraciones, aparte, promociones, letra pequeña'),

  /* ---------- 5 · Descuentos (interno) ---------- */
  E('des-1', 'descuentos', '', 'Cómo funciona la política de descuentos',
`La política de AppXpand sigue un sistema híbrido de autorización.

1. Cada paquete tiene un descuento máximo que el comercial puede aplicar directamente.
2. Si el cliente solicita un descuento superior, el comercial debe comunicarlo a dirección.
3. Se estudia la operación teniendo en cuenta el importe, la rentabilidad, el potencial del cliente y los servicios contratados.
4. Los proyectos grandes o personalizados pueden recibir autorizaciones especiales.`,
    'descuento, rebaja, autorización, dirección, margen, cuánto puedo bajar, regatear'),

  E('des-2', 'descuentos', '', 'Límites de descuento directo (pendiente de aprobación definitiva)',
`Propuesta de límites iniciales:

| Tipo de proyecto | Descuento directo |
| Básico | Hasta 5% |
| Medio | Hasta 5% |
| Premium | Hasta 7% |
| Personalizado | Requiere autorización |`,
    'descuento máximo, límite, porcentaje, tope, básico, medio, premium, personalizado, cuánto puedo bajar'),

  E('des-3', 'descuentos', '', 'Autorizaciones especiales',
`- Juanje: puede autorizar descuentos extraordinarios.
- Marta: puede autorizar descuentos extraordinarios en proyectos grandes al mismo nivel que Juanje.
- Comerciales: pueden negociar dentro de los límites establecidos.`,
    'autorizar, quién autoriza, juanje, marta, excepción, descuento extraordinario, consultar'),

  E('des-4', 'descuentos', '', 'Normas generales de descuentos',
`- Nunca ofrecer un precio inferior al mínimo autorizado.
- No acumular descuentos sin autorización.
- Los descuentos no se aplican automáticamente a mantenimientos ni extras.
- Toda excepción debe quedar registrada.
- Las comisiones comerciales se acuerdan individualmente antes de la incorporación de cada comercial.`,
    'normas, comisión, comisiones, acumular, mínimo, excepción, registrar, mantenimiento, extras'),

  /* ---------- 6 · Cierre de ventas ---------- */
  ...CAPTACION,

  E('cie-1', 'cierre', '', 'Paso 1. Identificar la necesidad', 'Entender qué problema tiene el cliente y qué solución necesita.', 'cerrar venta, proceso comercial, pasos, necesidad, diagnóstico'),
  E('cie-2', 'cierre', '', 'Paso 2. Presentar la propuesta', 'Explicar el servicio adecuado, sus ventajas y el presupuesto.', 'cerrar venta, proceso comercial, pasos, propuesta, presupuesto'),
  E('cie-3', 'cierre', '', 'Paso 3. Resolver objeciones', 'Escuchar, comprender la preocupación y responder con argumentos reales.', 'cerrar venta, proceso comercial, pasos, objeciones, dudas'),
  E('cie-4', 'cierre', '', 'Paso 4. Negociar', 'Si el cliente necesita mejores condiciones, aplicar los descuentos autorizados o consultar a dirección.', 'cerrar venta, proceso comercial, pasos, negociar, descuento'),
  E('cie-5', 'cierre', '', 'Paso 5. Cerrar', 'Confirmar los servicios contratados, el precio y las condiciones.', 'cerrar venta, proceso comercial, pasos, cierre, confirmar'),
  E('cie-6', 'cierre', '', 'Paso 6. Traspasar el proyecto',
`Una vez cerrada la venta, el comercial comunica la operación a Juanje.

Juanje revisa lo contratado y pasa a la fase de toma de requerimientos con el cliente para comenzar el desarrollo.`,
    'cerrar venta, proceso comercial, pasos, traspaso, después de vender, requerimientos, juanje'),

  /* ---------- 7 · Normativa ---------- */
  E('nor-1', 'normas', '', 'Principios comerciales de AppXpand',
`- No prometas funcionalidades que no estén confirmadas.
- No inventes plazos de entrega.
- No garantices resultados de posicionamiento SEO.
- No prometas descuentos fuera de tus competencias.
- No vendas servicios que no conocemos o no podemos desarrollar.
- No ocultes costes ni condiciones al cliente.
- No prometas soporte ilimitado.
- No confirmes una fecha de entrega sin validarla.
- Prioriza siempre la satisfacción del cliente y la rentabilidad del proyecto.`,
    'normas, reglas, prohibido, no prometer, plazos, seo, soporte, descuentos, costes, entrega')
];

/* Novedades que se añaden UNA sola vez a los paneles que ya tienen contenido (la «key» queda
   marcada al aplicarlas, así que si luego borras una entrada no vuelve). Van al principio de
   su sección. Para añadir más en el futuro: nuevo objeto con otra key. */
const SEED_BY_ID = id => KB_SEED.find(e => e.id === id);
export const KB_PATCHES = [
  { key: 'webs-2026-11', entries: WEB_PRICES },
  // Alinea el panel con el catálogo 2026: añade el paquete lanzadera y actualiza (solo si nadie las
  // ha editado a mano) las entradas de mantenimiento, condiciones y la FAQ de SEO.
  { key: 'catalogo-2026-11-b', base: -96, entries: [SEED_BY_ID('seed-pre-lanz')],
    updates: ['seed-pre-1', 'seed-pre-2', 'seed-pre-3', 'seed-pre-5', 'seed-faq-6'] },
  // Guion de captación: 8 entradas al principio de «Cierre de ventas».
  { key: 'captacion-2026-11', base: -50, entries: CAPTACION }
];
