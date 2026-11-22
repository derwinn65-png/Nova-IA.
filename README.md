# NOVA — starter 1.1

Este proyecto incluye una interfaz web responsive con avatar exclusivo de Nova, navegación funcional, backend Node.js, conexión de chat mediante API, cuentas, límites diarios y panel de propietario.

## Requisitos
- Node.js 20 o superior
- Una clave API del proveedor compatible con la API de OpenAI

## Instalación
1. Descomprime el proyecto.
2. En la carpeta, copia `.env.example` a `.env`.
3. Edita `.env`: añade `OPENAI_API_KEY`, cambia `JWT_SECRET`, `ADMIN_EMAIL` y `ADMIN_PASSWORD`.
4. Ejecuta `npm install`.
5. Ejecuta `npm start`.
6. Abre `http://localhost:3000`.

La cuenta propietaria se crea al iniciar el servidor si `ADMIN_EMAIL` y `ADMIN_PASSWORD` están configurados y esa cuenta aún no existe.

## Importante antes de publicarlo
- Usa HTTPS y un proveedor de hosting adecuado.
- No compartas el archivo `.env` ni la base de datos.
- Configura copias de seguridad, límites de solicitudes, verificación de correo y recuperación de contraseña.
- El registro público está abierto en este starter. Añade moderación y protecciones antiabuso antes de abrirlo al público.
- Los mensajes se envían al proveedor de IA configurado. Revisa sus políticas de privacidad y costes.
- El panel permite ajustar límites y publicar avisos/versiones; no es todavía un sistema de despliegue automático.
- Esta versión no compila APK. Para Android se recomienda empaquetar la web con Capacitor y configurar un proceso de compilación Android aparte.

## Alcance de la versión inicial
NOVA responde mediante el modelo configurado. Todavía no ejecuta código arbitrario, no crea archivos de proyectos automáticamente y no compila juegos o APK por sí sola. Esas funciones requieren un entorno de ejecución aislado, almacenamiento de proyectos y una cola de compilación segura.

## Identidad visual
El avatar oficial de Nova está en `public/nova-avatar.jpg` y aparece en la marca, bienvenida y respuestas del asistente.
