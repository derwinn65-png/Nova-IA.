# NOVA AI — versión mejorada

Aplicación web de Nova con interfaz móvil, cuentas de usuario, conversaciones guardadas, archivos adjuntos, generación de archivos y panel de administración. Backend en Node.js/Express y modelo Gemini.

## Requisitos
- Node.js 20 o superior.
- Una clave de Google Gemini (AI Studio).
- Variables de entorno configuradas en el servidor.

## Ejecutar localmente
1. Instala dependencias: `npm install`.
2. Configura `GEMINI_API_KEY`, `JWT_SECRET`, `ADMIN_EMAIL` y `ADMIN_PASSWORD`.
3. Opcional: configura `DATA_DIR` en una carpeta persistente y escribible.
4. Inicia: `npm start`.
5. Abre `http://localhost:3000`.

## Desplegar en Render
- Crea un servicio **Web Service** desde el repositorio.
- Runtime: Node.
- Build Command: `npm install`.
- Start Command: `npm start`.
- Añade estas variables en Environment:
  - `GEMINI_API_KEY`: clave de Google AI Studio.
  - `JWT_SECRET`: cadena aleatoria larga y privada (32+ caracteres).
  - `ADMIN_EMAIL`: correo de la cuenta administradora.
  - `ADMIN_PASSWORD`: contraseña inicial segura (8+ caracteres).
  - `GEMINI_MODEL`: opcional; por defecto `gemini-2.5-flash`.
  - `DATA_DIR`: opcional; usa `/var/data` si conectas un Persistent Disk en esa ruta.
- Para conservar usuarios, chats y archivos tras reinicios/despliegues, conecta un **Persistent Disk** y define `DATA_DIR=/var/data`. Sin disco persistente, el almacenamiento local del servicio puede perderse.

## Funciones y límites conocidos
- El chat y el análisis de imágenes usan Gemini; el tamaño máximo de cada archivo adjunto es 15 MB.
- Las imágenes se envían a Gemini como contenido visual; los demás formatos se guardan y se indican por nombre/tipo al modelo, no se extrae automáticamente el texto de todos los formatos.
- La generación de archivos produce texto/código descargable. No ejecuta código generado en el servidor.
- La generación de imágenes y video no está implementada como generación nativa; los botones informan que requieren modelos/servicios adicionales.
- El panel de administración permite revisar usuarios/archivos, ajustar límites y publicar un aviso/versión.

## Seguridad
No subas claves al repositorio. Configúralas como variables de entorno del servicio. Cambia la contraseña de administrador inicial y mantén `JWT_SECRET` privado.
