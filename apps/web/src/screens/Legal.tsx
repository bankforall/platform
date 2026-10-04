import { Link } from "react-router";
import { TERMS_VERSION } from "@bankforall/shared";
import termsSource from "../../../../docs/legal/terms-th.md?raw";
import privacySource from "../../../../docs/legal/privacy-th.md?raw";
import { Header, Screen } from "@/components/layout";
import { Card } from "@/components/ui";
import { APP_NAME } from "@/lib/brand";
import { Markdown } from "@/lib/markdown";

/** The legal documents live in docs/legal (reviewed by lawyers) and are bundled at build time. */
export const LEGAL_DOCS = {
  terms: { title: "ข้อกำหนดการใช้บริการ", source: termsSource },
  privacy: { title: "นโยบายความเป็นส่วนตัว", source: privacySource },
} as const;

export default function Legal({ doc }: { doc: keyof typeof LEGAL_DOCS }) {
  const { title, source } = LEGAL_DOCS[doc];
  const other = doc === "terms" ? "privacy" : "terms";
  return (
    <Screen nav={false}>
      <Header title={title} back />
      <main className="px-4 py-4">
        <Card>
          <Markdown source={source} vars={{ APP_NAME }} skipTitle />
        </Card>
        <p className="mt-4 text-center text-xs text-ink-muted">
          เวอร์ชัน {TERMS_VERSION} ·{" "}
          <Link to={`/${other}`} className="underline">
            {LEGAL_DOCS[other].title}
          </Link>
        </p>
      </main>
    </Screen>
  );
}
