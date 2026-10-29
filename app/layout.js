import "./globals.css";
export const metadata = { title: "Axway Preventive Maintenance Report Generator", description: "Generate Axway Preventive Maintenance reports as Word documents." };
export const viewport = { width: "device-width", initialScale: 1 };
export default function RootLayout({ children }) {
  return <html lang="en" suppressHydrationWarning>
    <head><script dangerouslySetInnerHTML={{ __html: `try{var t=localStorage.getItem("theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}` }} /></head>
    <body>{children}</body>
  </html>;
}
