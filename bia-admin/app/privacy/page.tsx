import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Notice · BIA 隐私声明",
  description:
    "How BIA@USC collects and uses product analytics across admin.uscbia.com and uscbia.com.",
};

const EFFECTIVE = "2026-06-06";
const CONTACT = "privacy@uscbia.com";

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-3xl px-6 py-16">
        <header className="border-b border-border pb-8">
          <p className="text-xs font-bold uppercase tracking-[0.22em] text-primary">
            BIA@USC
          </p>
          <h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
            Privacy Notice · 隐私声明
          </h1>
          <p className="mt-3 text-sm text-muted-foreground">
            Effective 生效日期 · {EFFECTIVE}
          </p>
        </header>

        <section className="mt-10 space-y-4 text-[15.5px] leading-relaxed">
          <p>
            Bridging Internationals Association (BIA) at USC runs the admin
            dashboard at <code className="rounded bg-muted px-1.5 py-0.5 text-[13.5px]">admin.uscbia.com</code>{" "}
            and the student site at{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 text-[13.5px]">uscbia.com</code>.
            This page explains what usage data we collect, why, and how to
            reach us about it.
          </p>
          <p className="text-muted-foreground">
            BIA（USC 新生协会）运营管理后台{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 text-[13.5px]">admin.uscbia.com</code>{" "}
            和学生站点{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 text-[13.5px]">uscbia.com</code>。
            本页说明我们收集哪些使用数据、用途，以及如何联系我们。
          </p>
        </section>

        <Section title="What we collect · 我们收集什么">
          <p>
            We use <a className="underline" href="https://posthog.com" target="_blank" rel="noopener noreferrer">PostHog</a>{" "}
            (US region) to record a small set of explicitly-defined product
            events, for example: a page is viewed, a parcel status is updated,
            a blog article reaches a workflow state. Each event includes a
            random anonymous identifier and the event name. Page URLs and
            timestamps travel with it.
          </p>
          <p className="text-muted-foreground">
            我们使用 PostHog（美国服务器）记录少量明确定义的产品事件，例如：访问了某个页面、包裹状态被更新、某篇文章进入下一个流程状态。每条事件只包含一个随机匿名标识符、事件名、页面路径与时间戳。
          </p>
        </Section>

        <Section title="What we don't collect · 我们不收集什么">
          <ul className="list-disc space-y-1.5 pl-6">
            <li>
              <b>No autocapture.</b> We have turned off PostHog's automatic
              page-content capture. Clicks, form values, and DOM text are
              never sent.
            </li>
            <li>
              <b>No personal identifiers in events.</b> Email, name, WeChat
              ID, and BIA member ID are excluded from event payloads by
              design.
            </li>
            <li>
              <b>No third-party advertising trackers.</b> The site has no
              advertising SDKs.
            </li>
          </ul>
          <ul className="mt-3 list-disc space-y-1.5 pl-6 text-muted-foreground">
            <li>
              <b>关闭自动采集。</b>PostHog 的自动页面内容采集已关闭。点击、表单内容、DOM 文本均不会上传。
            </li>
            <li>
              <b>事件不携带个人标识。</b>邮箱、姓名、微信号、会员 ID 不会进入事件负载。
            </li>
            <li>
              <b>没有第三方广告追踪。</b>站点不引入广告 SDK。
            </li>
          </ul>
        </Section>

        <Section title="Why we collect · 为什么收集">
          <p>
            BIA serves a 1,500+ member international student community at USC.
            We use aggregate usage data to understand which features help
            members, where they get stuck, and where we should invest our
            small team's time. Decisions about events, sponsors, shipping
            operations, and the blog are informed by this data.
          </p>
          <p className="text-muted-foreground">
            BIA 服务 USC 1500 多名国际学生。我们用聚合数据理解哪些功能真正有用、哪里卡住、应当把有限的精力投在哪里。活动、赞助、集运、文章相关决策会参考这些数据。
          </p>
        </Section>

        <Section title="Who can see it · 谁能看到">
          <p>
            Analytics dashboards in PostHog are visible only to BIA officers
            with the <code className="rounded bg-muted px-1.5 py-0.5 text-[13.5px]">super_admin</code>{" "}
            role. Data is stored on PostHog's US infrastructure under BIA's
            account.
          </p>
          <p className="text-muted-foreground">
            PostHog 分析面板仅 BIA 的 super_admin 角色可见。数据存储在 PostHog 美国基础设施的 BIA 账户下。
          </p>
        </Section>

        <Section title="Your choices · 你的选择">
          <p>
            If you would prefer your activity not be included in our
            aggregate analytics, email us at{" "}
            <a className="underline" href={`mailto:${CONTACT}`}>{CONTACT}</a>{" "}
            and we will exclude your account. We retain raw events for 12
            months and aggregate summaries indefinitely.
          </p>
          <p className="text-muted-foreground">
            如果不希望你的活动进入聚合分析，请发邮件到{" "}
            <a className="underline" href={`mailto:${CONTACT}`}>{CONTACT}</a>，我们会将你的账号排除在外。原始事件保留 12 个月，聚合统计无限期保留。
          </p>
        </Section>

        <Section title="Updates · 更新">
          <p>
            If we change what we collect or how we use it, we will update
            this page and bump the effective date at the top. Material
            changes will be announced in the BIA WeChat group.
          </p>
          <p className="text-muted-foreground">
            如果收集范围或用途有变化，我们会更新本页并修改顶部的生效日期。重大变更会在 BIA 微信群通知。
          </p>
        </Section>

        <Section title="Contact · 联系">
          <p>
            Questions, requests, or concerns:{" "}
            <a className="underline" href={`mailto:${CONTACT}`}>{CONTACT}</a>
          </p>
          <p className="text-muted-foreground">
            有疑问、请求或意见，请联系{" "}
            <a className="underline" href={`mailto:${CONTACT}`}>{CONTACT}</a>。
          </p>
        </Section>

        <footer className="mt-16 border-t border-border pt-6 text-sm text-muted-foreground">
          <Link href="/" className="underline">
            Back to BIA Admin
          </Link>
        </footer>
      </div>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">
        {title}
      </h2>
      <div className="mt-3 space-y-3 text-[15.5px] leading-relaxed">
        {children}
      </div>
    </section>
  );
}
