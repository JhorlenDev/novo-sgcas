import { Nunito } from "next/font/google";

// A tela de entrada tem identidade própria, com a Nunito do desenho original; o resto do
// sistema segue com a Public Sans do layout raiz. Carregada aqui, só baixa nesta rota.
const nunito = Nunito({
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

export default function LoginLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className={nunito.className} style={{ fontFeatureSettings: '"ss01", "ss02"' }}>
      {children}
    </div>
  );
}
