import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider, useQueryClient, useMutation } from "@tanstack/react-query";
import {
  ClerkProvider,
  SignIn,
  SignUp,
  Show,
  useAuth,
  useClerk,
  useUser,
} from "@clerk/react";
import { shadcn } from "@clerk/themes";
import {
  ArrowLeft,
  ArrowUpRight,
  Award,
  BarChart3,
  Bell,
  BookOpen,
  BriefcaseBusiness,
  CalendarDays,
  Check,
  ChevronLeft,
  CircleHelp,
  ClipboardCheck,
  Clock3,
  Download,
  FileText,
  Fingerprint,
  FolderKanban,
  GraduationCap,
  HeartHandshake,
  History,
  Home,
  LayoutDashboard,
  Link2,
  LogOut,
  Menu,
  MessageCircle,
  Plus,
  QrCode,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Target,
  Trophy,
  UserRound,
  UsersRound,
  X,
  Zap,
} from "lucide-react";
import { Route, Redirect, Switch, useLocation, Router as WouterRouter } from "wouter";
import {
  getGetMemberDashboardQueryKey,
  getGetLeaderDepartmentQueryKey,
  getGetMeQueryKey,
  getGetMyAchievementsQueryKey,
  getGetMyCreditsQueryKey,
  getGetMyMembershipCardQueryKey,
  getGetPresidentOverviewQueryKey,
  getGetSettingsQueryKey,
  getListAuditLogsQueryKey,
  getListCreditTypesQueryKey,
  getListDepartmentsQueryKey,
  getListLevelsQueryKey,
  getListPresidentMembersQueryKey,
  getListTransactionsQueryKey,
  useAwardCredit,
  useCheckActivation,
  useCreateAchievement,
  useCreateDepartment,
  useCreateMember,
  useGetLeaderDepartment,
  useGetMemberDashboard,
  useGetMe,
  useGetMyAchievements,
  useGetMyCredits,
  useGetMyMembershipCard,
  useGetPresidentOverview,
  useGetPublicMemberProfile,
  useGetSettings,
  useListAuditLogs,
  useListCreditTypes,
  useListDepartments,
  useListLevels,
  useListPresidentMembers,
  useListTransactions,
  useUpdateCreditType,
  useUpdateDepartment,
  useUpdateLevel,
  useUpdateMember,
  useUpdateSettings,
} from "@workspace/api-client-react";
import { ErrorBoundary } from "@/components/error-boundary";
import { Toaster } from "@/components/ui/toaster";
import { toast } from "@/hooks/use-toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";

function apiErrorMessage(error: any, fallback = "تعذر حفظ التغييرات، حاول مرة أخرى"): string {
  // The generated client throws ApiError with the parsed JSON body on `.data`
  // (not axios-style `.response.data`) -- see lib/api-client-react/src/custom-fetch.ts.
  return error?.data?.errorAr || error?.data?.error || fallback;
}

// The generated client (Orval) doesn't yet have createCreditType/createLevel
// hooks -- the OpenAPI spec and backend gained those two POST endpoints in
// this pass but a full `pnpm codegen` run wasn't executed. This mirrors the
// generated client's own request/error shape (see custom-fetch.ts) so
// apiErrorMessage works identically for these two calls; replace with the
// generated hooks next time codegen runs.
async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const err: any = new Error(data?.error || res.statusText);
    err.data = data;
    err.status = res.status;
    throw err;
  }
  return data as T;
}

const queryClient = new QueryClient();
const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
const clerkPubKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL || undefined;

function stripBase(path: string) {
  return basePath && path.startsWith(basePath) ? path.slice(basePath.length) || "/" : path;
}

const clerkAppearance = {
  theme: shadcn,
  cssLayerName: "clerk",
  options: {
    logoPlacement: "inside" as const,
    logoLinkUrl: basePath || "/",
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
    socialButtonsPlacement: "bottom" as const,
    socialButtonsVariant: "blockButton" as const,
  },
  variables: {
    colorPrimary: "#602B59",
    colorForeground: "#38243A",
    colorMutedForeground: "#765F74",
    colorDanger: "#B83F38",
    colorBackground: "#FFFDF8",
    colorInput: "#FBF5EA",
    colorInputForeground: "#38243A",
    colorNeutral: "#DCCEC5",
    fontFamily: "'OY Mandisa', 'Trebuchet MS', sans-serif",
    borderRadius: "0.75rem",
  },
  elements: {
    rootBox: "w-full flex justify-center",
    cardBox: "bg-[#fffdf8] rounded-2xl w-[440px] max-w-full overflow-hidden",
    card: "!shadow-none !border-0 !bg-transparent !rounded-none",
    footer: "!shadow-none !border-0 !bg-transparent !rounded-none",
    headerTitle: "text-[#602B59] font-bold",
    headerSubtitle: "text-[#765F74]",
    socialButtonsBlockButtonText: "text-[#38243A]",
    formFieldLabel: "text-[#38243A]",
    footerActionLink: "text-[#602B59] font-bold",
    footerActionText: "text-[#765F74]",
    dividerText: "text-[#765F74]",
    identityPreviewEditButton: "text-[#602B59]",
    formFieldSuccessText: "text-[#3F7F5E]",
    alertText: "text-[#7B2828]",
    logoBox: "p-2",
    logoImage: "object-contain",
    socialButtonsBlockButton: "border-[#DCCEC5] bg-[#FBF5EA] hover:bg-[#F5EBDD]",
    formButtonPrimary: "bg-[#602B59] hover:bg-[#4D2147] text-[#FFFDF8]",
    formFieldInput: "border-[#DCCEC5] bg-[#FBF5EA] text-[#38243A]",
    footerAction: "bg-transparent",
    dividerLine: "bg-[#DCCEC5]",
    alert: "bg-[#FCEDE9] border-[#E5B6A5]",
    otpCodeFieldInput: "border-[#DCCEC5] bg-[#FBF5EA]",
    formFieldRow: "text-[#38243A]",
    main: "bg-transparent",
  },
};

function BrandLogo({ light = false, compact = false }: { light?: boolean; compact?: boolean }) {
  return (
    <img
      src={`${basePath}/brand/${light ? "pmc-white.png" : "pmc-color.png"}`}
      alt="نادي إدارة المشاريع"
      className={compact ? "h-9 w-auto object-contain" : "h-12 w-auto object-contain"}
    />
  );
}

function IconBox({ children, tone = "plum" }: { children: ReactNode; tone?: "plum" | "orange" | "gold" | "lilac" }) {
  return <span className={`icon-box icon-box-${tone}`}>{children}</span>;
}

const arabicDateFormatter = new Intl.DateTimeFormat("ar-SA", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
const arabicDateShortFormatter = new Intl.DateTimeFormat("ar-SA", { weekday: "long", day: "numeric", month: "long" });
function todayLong() { return arabicDateFormatter.format(new Date()); }
function todayShort() { return arabicDateShortFormatter.format(new Date()); }

function Button({
  children,
  variant = "primary",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "soft" | "outline" | "ghost" }) {
  return (
    <button className={`button button-${variant} ${className}`} {...props}>
      {children}
    </button>
  );
}

function Badge({ children, tone = "gold" }: { children: ReactNode; tone?: "gold" | "orange" | "plum" | "green" | "muted" }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

function SectionTitle({ eyebrow, title, action }: { eyebrow?: string; title: string; action?: ReactNode }) {
  return (
    <div className="section-title">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h2>{title}</h2>
      </div>
      {action}
    </div>
  );
}

function HomePage() {
  const [, setLocation] = useLocation();
  return (
    <main className="landing texture">
      <header className="landing-nav page-in">
        <BrandLogo />
        <div className="landing-nav-actions">
          <button className="text-button" onClick={() => setLocation("/sign-in")}>تسجيل الدخول</button>
          <Button onClick={() => setLocation("/activate")}>تفعيل العضوية <ArrowLeft size={17} /></Button>
        </div>
      </header>
      <section className="hero page-in">
        <div className="hero-copy">
          <Badge tone="orange">PMC MEMBERSHIP · 2026–27</Badge>
          <h1>كل مساهمة<br /><span>تصنع أثراً.</span></h1>
          <p className="hero-lede">مساحتك لتوثّق ما تبنيه، تتقدم بمستواك، وتترك أثراً واضحاً داخل نادي إدارة المشاريع.</p>
          <div className="hero-ctas">
            <Button onClick={() => setLocation("/activate")}>تفعيل العضوية <ArrowLeft size={17} /></Button>
            <button className="link-button" onClick={() => setLocation("/sign-in")}>لديك حساب؟ سجّل دخولك <ChevronLeft size={16} /></button>
          </div>
          <div className="hero-proof">
            <div className="avatar-stack"><span>ن</span><span>س</span><span>ر</span><span>+</span></div>
            <span>انضم إلى مجتمع يبني المستقبل معاً</span>
          </div>
        </div>
        <div className="hero-art">
          <div className="hero-orbit orbit-one" />
          <div className="hero-orbit orbit-two" />
          <div className="hero-card">
            <div className="hero-card-top"><BrandLogo light compact /><Badge tone="gold">مثال توضيحي</Badge></div>
            <div className="hero-card-name">اسم العضو</div>
            <div className="hero-card-role">عضو مؤثر · القسم</div>
            <div className="hero-card-bottom"><span>PMC-XXXXXX</span><span className="font-mono">2026 / 27</span></div>
            <div className="hero-card-mark"><Sparkles size={28} /></div>
          </div>
          <div className="floating-stat floating-stat-top"><IconBox tone="gold"><Zap size={18} /></IconBox><div><strong>+XX</strong><small>PMC CREDITS</small></div></div>
          <div className="floating-stat floating-stat-bottom"><IconBox tone="orange"><Trophy size={18} /></IconBox><div><strong>LEVEL</strong><small>مثال</small></div></div>
        </div>
      </section>
      <section className="landing-strip">
        <div><span className="strip-number">01</span><strong>BUILD</strong><small>وثّق إنجازاتك</small></div>
        <div><span className="strip-number">02</span><strong>LEAD</strong><small>اصنع فرقاً مع فريقك</small></div>
        <div><span className="strip-number">03</span><strong>IMPACT</strong><small>شاهد أثر مساهمتك</small></div>
      </section>
      <section className="landing-bottom page-in">
        <div><p className="eyebrow">THE PMC WAY</p><h2>التقدم ليس رقماً فقط.<br /><span>إنه قصة تُبنى.</span></h2></div>
        <p>من أول تحدٍ إلى أول مشروع تقوده، كل خطوة تستحق أن تُرى. PMC يحوّل مساهماتك اليومية إلى مسار واضح للنمو.</p>
      </section>
    </main>
  );
}

function AuthPage({ signUp = false }: { signUp?: boolean }) {
  return (
    <div className="auth-page texture">
      <div className="auth-back"><a href={`${basePath || ""}/`}><ArrowRightIcon /> العودة للموقع</a></div>
      <div className="auth-brand"><BrandLogo /><span>مساحتك لبناء الأثر</span></div>
      {signUp ? (
        <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} />
      ) : (
        <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} />
      )}
    </div>
  );
}

function ArrowRightIcon() { return <ArrowLeft size={16} className="rotate-180" />; }

function ClerkCacheInvalidator() {
  const { addListener } = useClerk();
  const client = useQueryClient();
  const previous = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const id = user?.id ?? null;
      if (previous.current !== undefined && previous.current !== id) client.clear();
      previous.current = id;
    });
    return unsubscribe;
  }, [addListener, client]);
  return null;
}

function AppShell({
  children,
  user,
}: {
  children: ReactNode;
  user: any;
}) {
  const [location, setLocation] = useLocation();
  const { signOut } = useClerk();
  const [mobileOpen, setMobileOpen] = useState(false);

  const memberNav: Array<readonly [string, string, any]> = [
    ["/app", "نظرة عامة", LayoutDashboard],
    ["/app/credits", "رصيد PMC", Zap],
    ["/app/achievements", "إنجازاتي", Trophy],
    ["/app/card", "بطاقتي الرقمية", Fingerprint],
    ["/app/profile", "ملفي الشخصي", UserRound],
  ];

  const leaderNav: Array<readonly [string, string, any]> =
    user?.role === "DEPARTMENT_LEADER"
      ? [["/app/team", "فريقي", UsersRound] as const]
      : [];

  const presidentNav: Array<readonly [string, string, any]> =
    user?.role === "PRESIDENT"
      ? [
          ["/app/president", "نظرة الرئيس", BarChart3],
          ["/app/members", "الأعضاء", UsersRound],
          ["/app/departments", "الإدارات", BriefcaseBusiness],
          ["/app/admin-credits", "أنواع الرصيد", Zap],
          ["/app/admin-achievements", "إدارة الإنجازات", Award],
          ["/app/settings", "إعدادات النادي", Settings2],
          ["/app/audit", "سجل التدقيق", History],
        ]
      : [];

  const nav = [...memberNav, ...leaderNav, ...presidentNav];

  const currentLabel =
    nav.find(([href]) => href === location)?.[1] || "الرئيسية";

  return (
    <div className="app-frame texture">
      <aside className={`sidebar ${mobileOpen ? "sidebar-open" : ""}`}>
        <div className="sidebar-top">
          <BrandLogo light />
          <button
            className="mobile-close"
            onClick={() => setMobileOpen(false)}
          >
            <X size={20} />
          </button>
        </div>

        <div className="sidebar-context">
          <span className="context-dot" />
          {user?.role === "PRESIDENT"
            ? "PRESIDENT SPACE"
            : user?.role === "DEPARTMENT_LEADER"
              ? "LEADER SPACE"
              : "MEMBER SPACE"}
        </div>

        <nav>
          {nav.map(([href, label, Icon]) => (
            <button
              key={href}
              className={location === href ? "nav-item active" : "nav-item"}
              onClick={() => {
                setLocation(href);
                setMobileOpen(false);
              }}
            >
              <Icon size={18} />
              <span>{label}</span>
              {location === href && <ChevronLeft size={15} />}
            </button>
          ))}
        </nav>

        <div className="sidebar-note">
          <Sparkles size={18} />
          <div>
            <strong>
              {user?.role === "PRESIDENT" ? "أدر الأثر" : "ابنِ مسارك"}
            </strong>
            <small>
              {user?.role === "PRESIDENT"
                ? "كل قرار يصنع فرقاً."
                : "كل خطوة محسوبة."}
            </small>
          </div>
        </div>

        <div className="sidebar-bottom">
          <button
            className="nav-item"
            onClick={() => setLocation("/app/profile")}
          >
            <CircleHelp size={18} />
            <span>مركز المساعدة</span>
          </button>

          <button
            className="profile-mini"
            onClick={() => setLocation("/app/profile")}
          >
            <span className="avatar avatar-plum">
              {(user?.fullName || "م").slice(0, 1)}
            </span>
            <span>
              <strong>{user?.fullName || "عضو PMC"}</strong>
              <small>
                {user?.role === "PRESIDENT"
                  ? "PRESIDENT"
                  : user?.role === "DEPARTMENT_LEADER"
                    ? "DEPARTMENT LEADER"
                    : user?.level?.nameEn || "MEMBER"}
              </small>
            </span>
            <ChevronLeft size={15} />
          </button>

          <button
            className="logout-button"
            onClick={() => signOut({ redirectUrl: basePath || "/" })}
          >
            <LogOut size={15} />
            تسجيل الخروج
          </button>
        </div>
      </aside>

      <div className="app-content">
        <header className="topbar">
          <button
            className="mobile-menu"
            onClick={() => setMobileOpen(true)}
          >
            <Menu size={22} />
          </button>

          <div className="breadcrumb">
            <span>مساحتي</span>
            <ChevronLeft size={14} />
            <strong>{currentLabel}</strong>
          </div>

          <div className="topbar-actions">
            <span className="icon-button" aria-hidden="true">
              <Bell size={18} />
            </span>
            <span className="topbar-separator" />
            <span className="topbar-date">{todayLong()}</span>
          </div>
        </header>

        <main className="page-content page-in">{children}</main>
      </div>
    </div>
  );
}
function LoadingState({ label = "نجهز مساحتك..." }: { label?: string }) { return <div className="state-card"><div className="spinner" /><p>{label}</p></div>; }
function ErrorState({ label = "تعذر تحميل البيانات حالياً." }: { label?: string }) { return <div className="state-card state-error"><CircleHelp size={25} /><p>{label}</p><small>تحقق من الاتصال ثم حاول مرة أخرى.</small></div>; }
function EmptyState({ label = "لا توجد عناصر بعد." }: { label?: string }) { return <div className="empty-state"><Sparkles size={24} /><p>{label}</p></div>; }

function MemberRoute({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) return <LoadingState />;
  if (!isSignedIn) return <Redirect to="/" />;
  return <>{children}</>;
}

function MemberData() {
  const { data: user, isLoading, isError } = useGetMe({ query: { queryKey: getGetMeQueryKey(), enabled: true } });
  if (isLoading) return <LoadingState />;
  if (isError || !user) return <ErrorState label="لم نتمكن من قراءة حسابك." />;
  return <MemberApp user={user} />;
}

function MemberApp({ user }: { user: any }) {
  const [location] = useLocation();

  let page;

  if (location === "/app") {
    page = <MemberHome user={user} />;
  } else if (
    location === "/app/team" &&
    user?.role === "DEPARTMENT_LEADER"
  ) {
    page = <LeaderPage user={user} />;
  } else if (location === "/app/credits") {
    page = <CreditsPage />;
  } else if (location === "/app/achievements") {
    page = <AchievementsPage />;
  } else if (location === "/app/card") {
    page = <CardPage />;
  } else if (location === "/app/profile") {
    page = <ProfilePage user={user} />;
  } else if (
    location === "/app/president" &&
    user?.role === "PRESIDENT"
  ) {
    page = <AdminOverview user={user} />;
  } else if (
    location === "/app/members" &&
    user?.role === "PRESIDENT"
  ) {
    page = <AdminDataPage kind="members" user={user} />;
  } else if (
    location === "/app/departments" &&
    user?.role === "PRESIDENT"
  ) {
    page = <AdminDataPage kind="departments" user={user} />;
  } else if (
    location === "/app/admin-credits" &&
    user?.role === "PRESIDENT"
  ) {
    page = <AdminDataPage kind="credits" user={user} />;
  } else if (
    location === "/app/admin-achievements" &&
    user?.role === "PRESIDENT"
  ) {
    page = <AdminDataPage kind="achievements" user={user} />;
  } else if (
    location === "/app/settings" &&
    user?.role === "PRESIDENT"
  ) {
    page = <AdminDataPage kind="settings" user={user} />;
  } else if (
    location === "/app/audit" &&
    user?.role === "PRESIDENT"
  ) {
    page = <AdminDataPage kind="audit" user={user} />;
  } else {
    page = <MemberHome user={user} />;
  }

  return <AppShell user={user}>{page}</AppShell>;
}
function MemberHome() {
  const { data: dashboard, isLoading, isError } = useGetMemberDashboard();
  const { data: credits } = useGetMyCredits(undefined, { query: { queryKey: getGetMyCreditsQueryKey(), enabled: true } });
  const { data: achievements } = useGetMyAchievements();
  const { data: card } = useGetMyMembershipCard();
  if (isLoading) return <LoadingState />;
  if (isError || !dashboard) return <ErrorState />;
  const member = dashboard.member;
  return (
    <>
      <div className="welcome-row"><div><p className="eyebrow">MEMBER SPACE · {todayShort()}</p><h1>أهلاً، {member.fullName.split(" ")[0]} <span className="wave-mark">✦</span></h1><p className="subtle">جاهز تضيف خطوة جديدة لمسارك اليوم؟</p></div></div>
      <section className="dashboard-grid">
        <div className="main-column">
          <div className="level-hero lift"><div className="level-copy"><div className="hero-label"><IconBox tone="gold"><Zap size={18} /></IconBox><span>مستواك الحالي</span></div><h2>{member.level.nameAr} <span className="latin">· {member.level.nameEn}</span></h2><p>أنت في منتصف الطريق. مساهمة أخرى وتقترب من المستوى التالي.</p><div className="progress-meta"><span>{member.level.current} PMC CREDITS</span><span>{member.level.nextThreshold ? `${member.level.nextThreshold - member.level.current} للخطوة القادمة` : "المستوى الأعلى"}</span></div><div className="progress-track"><span style={{ width: `${member.level.progressPercent}%` }} /></div><div className="level-next"><span>{member.level.symbol} {member.level.nameEn}</span><span>{member.level.progressPercent}%</span></div></div><div className="level-emblem"><span>{member.level.symbol}</span><small>LEVEL<br />{member.level.key}</small></div></div>
          <div className="stats-grid"><StatCard icon={<FolderKanban size={19} />} label="مشاريع" value={dashboard.stats.projects} tone="plum" /><StatCard icon={<Target size={19} />} label="تحديات" value={dashboard.stats.challenges} tone="orange" /><StatCard icon={<UsersRound size={19} />} label="قيادة" value={dashboard.stats.leadership} tone="gold" /><StatCard icon={<CalendarDays size={19} />} label="عضو منذ" value={dashboard.stats.memberSince} tone="lilac" /></div>
          <section className="panel"><SectionTitle eyebrow="RECENT CONTRIBUTION" title="آخر مساهماتك" action={<a className="panel-link" href={`${basePath}/app/credits`}>عرض الكل <ChevronLeft size={14} /></a>} />{dashboard.recentCredits?.length ? <div className="activity-list">{dashboard.recentCredits.slice(0, 4).map((item: any) => <ActivityRow key={item.id} item={item} />)}</div> : <EmptyState label="ابدأ بتوثيق أول مساهمة لك." />}</section>
        </div>
        <aside className="side-column">
          <section className="profile-card"><div className="profile-card-top"><span className="avatar avatar-large">{member.fullName.slice(0, 1)}</span><Badge tone="green">عضو نشط</Badge></div><h3>{member.fullName}</h3><p>{member.memberId} · {member.department || "—"}</p><div className="profile-card-meta"><span><GraduationCap size={15} /> {member.college || "—"}</span><span><BriefcaseBusiness size={15} /> {member.major || "—"}</span></div><a className="outline-link" href={`${basePath}/app/profile`}>عرض الملف <ArrowLeft size={15} /></a></section>
          <section className="card-preview"><div className="card-preview-head"><span>بطاقتك الرقمية</span><button onClick={() => window.location.assign(`${basePath}/app/card`)}><ArrowUpRight size={17} /></button></div><div className="mini-card"><BrandLogo light compact /><div><strong>{card?.memberName || member.fullName}</strong><small>{card?.level?.nameEn || member.level.nameEn} · {member.memberId}</small></div><div className="mini-card-code"><QrCode size={24} /></div></div><p>بطاقتك جاهزة للمشاركة</p></section>
          <section className="panel compact-panel"><SectionTitle eyebrow="ACHIEVEMENTS" title="آخر إنجازاتك" action={<a className="panel-link" href={`${basePath}/app/achievements`}><ChevronLeft size={15} /></a>} />{achievements?.length ? achievements.slice(0, 3).map((a: any) => <AchievementRow key={a.id} item={a} />) : <EmptyState label="إنجازاتك ستظهر هنا." />}</section>
        </aside>
      </section>
    </>
  );
}

function StatCard({ icon, label, value, tone }: { icon: ReactNode; label: string; value: ReactNode; tone: string }) {
  return <div className="stat-card lift"><IconBox tone={tone as any}>{icon}</IconBox><div><span>{label}</span><strong>{value}</strong></div><ArrowUpRight size={15} className="stat-arrow" /></div>;
}

function ActivityRow({ item }: { item: any }) {
  return <div className="activity-row"><IconBox tone={item.activityType === "PROJECT" ? "plum" : item.activityType === "LEADERSHIP" ? "orange" : "gold"}>{item.activityType === "PROJECT" ? <FolderKanban size={17} /> : item.activityType === "LEADERSHIP" ? <UsersRound size={17} /> : <Sparkles size={17} />}</IconBox><div className="activity-detail"><strong>{item.activityName}</strong><small>{item.creditType?.nameAr || item.activityType} · {item.createdAt?.slice(0, 10)}</small></div><span className="credit-plus">+{item.creditValue}</span></div>;
}

function AchievementRow({ item }: { item: any }) { return <div className="achievement-row"><span className="achievement-symbol"><Trophy size={16} /></span><div><strong>{item.title}</strong><small>{item.activity}</small></div><ChevronLeft size={14} /></div>; }

function downloadClientCsv(filename: string, header: string[], rows: (string | number)[][]) {
  const csv = [header, ...rows]
    .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function CreditsPage() {
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const { data, isLoading, isError } = useGetMyCredits(filter === "all" ? undefined : { activityType: filter as any });
  if (isLoading) return <LoadingState />;
  if (isError) return <ErrorState />;
  const filtered = (data || []).filter((item: any) => !search || item.activityName?.toLowerCase().includes(search.toLowerCase()) || item.creditType?.nameAr?.includes(search));
  return <><SectionTitle eyebrow="MY CONTRIBUTION" title="رصيد PMC" action={<Button variant="soft" onClick={() => downloadClientCsv("pmc-credits.csv", ["التاريخ", "النشاط", "النوع", "القيمة"], (data || []).map((item: any) => [item.createdAt?.slice(0, 10) || "", item.activityName, item.creditType?.nameAr || item.activityType, item.creditValue]))} disabled={!data?.length}><Download size={16} /> تصدير السجل</Button>} /><div className="credits-summary"><div><span>إجمالي الرصيد</span><strong>{data?.reduce((sum: number, item: any) => sum + item.creditValue, 0) || 0}<small> PMC CREDITS</small></strong></div><div><span>عدد المساهمات</span><strong>{data?.length || 0}</strong></div><div><span>آخر نشاط</span><strong>{data?.[0]?.createdAt?.slice(0, 10) || "—"}</strong></div></div><section className="panel"><div className="filter-row"><div className="tabs">{[["all", "الكل"], ["projects", "المشاريع"], ["challenges", "التحديات"], ["leadership", "القيادة"]].map(([key, label]) => <button key={key} className={filter === key ? "tab active" : "tab"} onClick={() => setFilter(key)}>{label}</button>)}</div><div className="search-field"><Search size={16} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ابحث في مساهماتك" /></div></div>{filtered.length ? <div className="activity-list large-list">{filtered.map((item: any) => <ActivityRow key={item.id} item={item} />)}</div> : <EmptyState label="لم تُسجل مساهمات بهذا التصنيف." />}</section></>;
}

function AchievementsPage() {
  const { data, isLoading, isError } = useGetMyAchievements();
  if (isLoading) return <LoadingState />;
  if (isError) return <ErrorState />;
  return <><SectionTitle eyebrow="MY JOURNEY" title="إنجازاتي" action={<Badge tone="gold">{data?.length || 0} إنجاز</Badge>} /><div className="achievement-intro"><div className="achievement-intro-mark"><Trophy size={33} /></div><div><h3>كل إنجاز يرفع سقفك</h3><p>هنا تتجمع اللحظات التي صنعتها داخل PMC. استمر، فالمستوى القادم ينتظرك.</p></div></div><div className="achievement-grid">{data?.length ? data.map((item: any) => <article className="achievement-card lift" key={item.id}><div className="achievement-card-head"><span className="achievement-big-symbol"><Trophy size={22} /></span><Badge tone="green">موثق</Badge></div><h3>{item.title}</h3><p>{item.description || item.activity}</p><footer><span>{item.type}</span><span>{item.date}</span></footer></article>) : <EmptyState label="أنجز أول تحدٍ لتظهر قصتك هنا." />}</div></>;
}

function CardPage() {
  const { data, isLoading, isError } = useGetMyMembershipCard();
  if (isLoading) return <LoadingState />;
  if (isError || !data) return <ErrorState />;
  const publicProfileUrl = `${window.location.origin}${basePath}/member/${data.memberId}`;
  const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=8&data=${encodeURIComponent(publicProfileUrl)}`;
  const copyProfileLink = async () => {
    try {
      await navigator.clipboard.writeText(publicProfileUrl);
      toast({ title: "تم نسخ رابط الملف" });
    } catch {
      toast({ title: "تعذر نسخ الرابط، حاول مرة أخرى", variant: "destructive" });
    }
  };
  const shareProfile = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: data.memberName, url: publicProfileUrl });
      } catch {
        // user cancelled the share sheet -- not an error
      }
    } else {
      await copyProfileLink();
    }
  };
  return <><SectionTitle eyebrow="IDENTITY" title="بطاقتي الرقمية" /><div className="card-layout"><div className="digital-card-large"><div className="digital-card-header"><BrandLogo light /><Badge tone="gold">ACTIVE MEMBER</Badge></div><div className="digital-card-body"><span className="digital-card-label">MEMBER ID</span><strong>{data.memberId}</strong><h2>{data.memberName}</h2><p>{data.level?.nameAr || "—"} · {data.membershipYear}</p></div><div className="digital-card-footer"><span>PMC MEMBERSHIP · {data.membershipYear}</span><a href={publicProfileUrl} target="_blank" rel="noreferrer" title="فتح رابط التحقق"><img src={qrImageUrl} alt="QR verification code" width={72} height={72} style={{ borderRadius: 8, background: "white", padding: 4 }} /></a></div></div><div className="card-share-panel"><IconBox tone="plum"><QrCode size={22} /></IconBox><h3>شارك هويتك</h3><p>أظهر بطاقتك لأي شخص داخل PMC أو شارك ملفك العام عبر رابط واحد.</p><Button variant="soft" onClick={copyProfileLink}><Link2 size={16} /> نسخ رابط الملف</Button><Button variant="outline" onClick={shareProfile}><MessageCircle size={16} /> مشاركة</Button></div></div></>;
}

function ProfilePage({ user }: { user: any }) {
  return <><SectionTitle eyebrow="MY PROFILE" title="ملفي الشخصي" /><section className="profile-hero"><span className="avatar avatar-xl">{user.fullName?.slice(0, 1)}</span><div><Badge tone="green">{user.membershipStatus}</Badge><h2>{user.fullName}</h2><p>{user.email} · {user.memberId}</p></div><div className="profile-level"><span>المستوى الحالي</span><strong>{user.level?.symbol} {user.level?.nameAr}</strong></div></section><div className="form-panel"><div className="form-section"><h3>بيانات العضوية</h3><div className="form-grid"><ReadOnlyField label="الاسم الكامل" value={user.fullName} /><ReadOnlyField label="البريد الإلكتروني" value={user.email} /><ReadOnlyField label="الكلية" value={user.college || "—"} /><ReadOnlyField label="التخصص" value={user.major || "—"} /></div></div></div></>;
}

function ReadOnlyField({ label, value }: { label: string; value: string }) { return <label className="read-field"><span>{label}</span><strong>{value}</strong></label>; }

function LeaderPage({ user }: { user: any }) {
  const [showForm, setShowForm] = useState(false);
  const [presetMemberId, setPresetMemberId] = useState<string | undefined>(undefined);
  const [memberSearch, setMemberSearch] = useState("");
  const { data, isLoading, isError } = useGetLeaderDepartment();
  const { data: creditTypes } = useListCreditTypes();
  const { data: levels } = useListLevels();
  const award = useAwardCredit();
  const createAchievement = useCreateAchievement();
  const createDepartmentMember = useMutation({
    mutationFn: (payload: any) => postJson<any>("/api/leader/members", payload),
  });
  const [showMemberForm, setShowMemberForm] = useState(false);
  const queryClient = useQueryClient();
  if (isLoading) return <LoadingState />;
  if (isError || !data) return <ErrorState label="هذه المساحة مخصصة لقادة الإدارات." />;

  const q = memberSearch.trim().toLowerCase();
  const visibleMembers = (data.members || []).filter((m: any) =>
    !q || m.fullName?.toLowerCase().includes(q) || m.memberId?.toLowerCase().includes(q) || m.email?.toLowerCase().includes(q),
  );

  const activeLevels = (levels || []).filter((l: any) => l.active).sort((a: any, b: any) => a.minCredits - b.minCredits);
  const memberLevelKeys = (data.members || [])
    .map((m: any) => {
      let current = activeLevels[0];
      for (const lvl of activeLevels) if ((m.credits ?? 0) >= lvl.minCredits) current = lvl;
      return current;
    })
    .filter(Boolean);
  const averageLevelLabel = memberLevelKeys.length
    ? (() => {
        const counts = new Map<string, number>();
        for (const l of memberLevelKeys) counts.set(l.nameEn, (counts.get(l.nameEn) || 0) + 1);
        return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
      })()
    : "—";

  return <><div className="welcome-row"><div><p className="eyebrow">LEADERSHIP SPACE · {data.department?.nameEn}</p><h1>{data.department?.nameAr}</h1><p className="subtle">قد فريقك بوضوح، واجعل مساهمات الأعضاء مرئية.</p></div><div className="welcome-actions"><Button variant="outline" onClick={() => setShowMemberForm(true)}><UserRound size={17} /> إضافة عضو</Button><Button onClick={() => { setPresetMemberId(undefined); setShowForm(true); }}><Plus size={17} /> أضف رصيداً</Button></div></div><div className="stats-grid leader-stats"><StatCard icon={<UsersRound size={19} />} label="أعضاء الإدارة" value={data.members?.length || 0} tone="plum" /><StatCard icon={<Zap size={19} />} label="إجمالي الرصيد" value={data.members?.reduce((n: number, m: any) => n + m.credits, 0) || 0} tone="gold" /><StatCard icon={<Trophy size={19} />} label="متوسط المستوى" value={averageLevelLabel} tone="orange" /></div>{showMemberForm && <AddLeaderMemberModal department={data.department} loading={createDepartmentMember.isPending} onClose={() => setShowMemberForm(false)} onSubmit={(payload) => createDepartmentMember.mutate(payload, { onSuccess: () => { queryClient.invalidateQueries({ queryKey: getGetLeaderDepartmentQueryKey() }); setShowMemberForm(false); toast({ title: "تمت إضافة العضو بنجاح" }); }, onError: (error: any) => toast({ title: apiErrorMessage(error, "تعذر إضافة العضو"), variant: "destructive" }) })} />} {showForm && <CreditForm members={data.members} creditTypes={creditTypes || []} initialMemberId={presetMemberId} onClose={() => setShowForm(false)} onSubmit={(payload) => { award.mutate({ data: payload } as any, { onSuccess: () => { queryClient.invalidateQueries({ queryKey: getGetLeaderDepartmentQueryKey() }); setShowForm(false); toast({ title: "تمت إضافة الرصيد بنجاح" }); }, onError: (error: any) => toast({ title: apiErrorMessage(error, "تعذر إضافة الرصيد"), variant: "destructive" }) }); }} loading={award.isPending} /> }<section className="panel"><SectionTitle eyebrow="TEAM PULSE" title="مساهمات فريقك" action={<div className="search-field"><Search size={16} /><input value={memberSearch} onChange={(e) => setMemberSearch(e.target.value)} placeholder="ابحث عن عضو" /></div>} />{visibleMembers.length ? <div className="member-table">{visibleMembers.map((member: any) => <div className="member-row" key={member.id}><span className="avatar avatar-small">{member.fullName.slice(0, 1)}</span><div><strong>{member.fullName}</strong><small>{member.memberId}</small></div><span className="member-level">{member.level?.symbol} {member.level?.nameEn}</span><strong className="member-credits">{member.credits} <small>credits</small></strong><Badge tone={member.membershipStatus === "APPROVED" ? "green" : "muted"}>{member.membershipStatus}</Badge>{member.role === "MEMBER" && <button className="icon-button" title="إضافة رصيد لهذا العضو" onClick={() => { setPresetMemberId(member.memberId); setShowForm(true); }}><Plus size={15} /></button>}</div>)}</div> : <EmptyState label={q ? "لا نتائج مطابقة لبحثك." : "لا يوجد أعضاء في إدارتك بعد."} />}</section></>;
}

function AddLeaderMemberModal({ department, onClose, onSubmit, loading }: { department: any; onClose: () => void; onSubmit: (data: any) => void; loading: boolean }) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [universityId, setUniversityId] = useState("");
  const [college, setCollege] = useState("");
  const [major, setMajor] = useState("");
  const [membershipStatus, setMembershipStatus] = useState<"PENDING" | "APPROVED">("APPROVED");
  const valid = Boolean(fullName.trim().length >= 2 && email.includes("@") && universityId.trim() && college.trim() && major.trim());
  return <div className="modal-backdrop"><div className="modal-card"><div className="modal-head"><div><p className="eyebrow">ADD MEMBER</p><h2>إضافة عضو إلى {department?.nameAr || "القسم"}</h2></div><button className="icon-button" onClick={onClose}><X size={19} /></button></div><div className="form-grid"><label className="input-label input-wide"><span>الاسم الكامل</span><input value={fullName} onChange={(e) => setFullName(e.target.value)} /></label><label className="input-label"><span>البريد الإلكتروني</span><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label><label className="input-label"><span>الرقم الجامعي</span><input value={universityId} onChange={(e) => setUniversityId(e.target.value)} /></label><label className="input-label"><span>الكلية</span><input value={college} onChange={(e) => setCollege(e.target.value)} /></label><label className="input-label"><span>التخصص</span><input value={major} onChange={(e) => setMajor(e.target.value)} /></label><label className="input-label"><span>القسم</span><input value={department?.nameAr || ""} disabled /></label><label className="input-label"><span>حالة العضوية</span><select value={membershipStatus} onChange={(e) => setMembershipStatus(e.target.value as any)}><option value="APPROVED">معتمدة</option><option value="PENDING">قيد الانتظار</option></select></label></div><div className="modal-actions"><Button variant="ghost" onClick={onClose}>إلغاء</Button><Button disabled={!valid || loading} onClick={() => onSubmit({ fullName: fullName.trim(), email: email.trim(), universityId: universityId.trim(), college: college.trim(), major: major.trim(), membershipStatus })}>{loading ? "جارٍ الإضافة..." : "إضافة العضو"}</Button></div></div></div>;
}

function CreditForm({ members, creditTypes, onClose, onSubmit, loading, initialMemberId }: { members: any[]; creditTypes: any[]; onClose: () => void; onSubmit: (data: any) => void; loading: boolean; initialMemberId?: string }) {
  const eligibleMembers = members.filter((m: any) => m.role === "MEMBER");
  const [memberId, setMemberId] = useState(initialMemberId || eligibleMembers[0]?.memberId || "");
  const [creditTypeId, setCreditTypeId] = useState(creditTypes[0]?.id || 1);
  const [activityName, setActivityName] = useState("");
  const [activityDate, setActivityDate] = useState("2026-08-28");
  return <div className="modal-backdrop"><div className="modal-card"><div className="modal-head"><div><p className="eyebrow">LEAD CREDIT</p><h2>توثيق مساهمة</h2></div><button className="icon-button" onClick={onClose}><X size={19} /></button></div><div className="form-grid"><label className="input-label"><span>العضو</span><select value={memberId} onChange={(e) => setMemberId(e.target.value)}>{eligibleMembers.map((m: any) => <option key={m.memberId} value={m.memberId}>{m.fullName}</option>)}</select></label><label className="input-label"><span>نوع الرصيد</span><select value={creditTypeId} onChange={(e) => setCreditTypeId(Number(e.target.value))}>{creditTypes.map((t: any) => <option key={t.id} value={t.id}>{t.nameAr} · {t.creditValue}</option>)}</select></label><label className="input-label input-wide"><span>اسم النشاط</span><input value={activityName} onChange={(e) => setActivityName(e.target.value)} placeholder="مثال: تنظيم ورشة إدارة المخاطر" /></label><label className="input-label"><span>تاريخ النشاط</span><input type="date" value={activityDate} onChange={(e) => setActivityDate(e.target.value)} /></label></div><div className="modal-actions"><Button variant="outline" onClick={onClose}>إلغاء</Button><Button disabled={!activityName || !memberId || loading} onClick={() => onSubmit({ memberId, creditTypeId, activityName, activityDate })}>{loading ? "جارٍ الحفظ..." : "حفظ المساهمة"} <Check size={16} /></Button></div></div></div>;
}

function AdminOverview({ user }: { user: any }) {
  const { data, isLoading, isError } = useGetPresidentOverview();
  const { data: members } = useListPresidentMembers();
  const { data: transactions } = useListTransactions();
  const { data: departments } = useListDepartments();
  const { data: levels } = useListLevels();
  const { data: audit } = useListAuditLogs();
  if (isLoading) return <LoadingState />;
  if (isError || !data) return <ErrorState label="تعذر تحميل لوحة الرئيس." />;
  return <><div className="welcome-row"><div><p className="eyebrow">PRESIDENT CONSOLE · 2026–27</p><h1>صباح الأثر، {user.fullName?.split(" ")[0]}</h1><p className="subtle">نظرة واحدة على نبض النادي ومساهماته.</p></div><Button variant="soft" onClick={() => window.open("/api/president/members/export.csv", "_blank")}><Download size={17} /> تصدير الأعضاء (CSV)</Button></div><div className="overview-metrics"><Metric label="الأعضاء النشطون" value={data.totalActiveMembers} change="عضو معتمد" tone="plum" icon={<UsersRound size={19} />} /><Metric label="بانتظار المراجعة" value={data.pendingMembers} change="يحتاج انتباهك" tone="orange" icon={<Clock3 size={19} />} /><Metric label="إجمالي الرصيد" value={data.totalCredits} change="PMC CREDITS" tone="gold" icon={<Zap size={19} />} /><Metric label="الإدارات" value={data.totalDepartments} change="وحدات فعالة" tone="lilac" icon={<BriefcaseBusiness size={19} />} /></div><div className="overview-columns"><section className="panel"><SectionTitle eyebrow="MEMBERS BY LEVEL" title="توزيع الأعضاء" /><div className="level-bars">{data.membersByLevel?.map((item: any, i: number) => <div className="level-bar-row" key={item.level}><span>{item.level}</span><div className="bar"><i className={`bar-${i}`} style={{ width: `${Math.max(12, (item.count / Math.max(...data.membersByLevel.map((x: any) => x.count), 1)) * 100)}%` }} /></div><strong>{item.count}</strong></div>)}</div></section><section className="panel"><SectionTitle eyebrow="ATTENTION" title="يحتاج متابعة" /><div className="attention-list">{data.closeToNextLevel?.slice(0, 4).map((member: any) => <div key={member.id} className="attention-row"><span className="avatar avatar-small">{member.fullName.slice(0, 1)}</span><div><strong>{member.fullName}</strong><small>{member.credits} credits · {member.level?.nameEn}</small></div><ChevronLeft size={15} /></div>)}</div></section></div><section className="panel"><SectionTitle eyebrow="LATEST MEMBERS" title="أحدث الأعضاء" action={<a className="panel-link" href={`${basePath}/admin/members`}>إدارة الأعضاء <ChevronLeft size={14} /></a>} /><div className="member-table">{(data.recentMembers || members || []).slice(0, 5).map((member: any) => <div className="member-row" key={member.id}><span className="avatar avatar-small">{member.fullName.slice(0, 1)}</span><div><strong>{member.fullName}</strong><small>{member.email}</small></div><span className="member-level">{member.level?.symbol} {member.level?.nameEn}</span><strong className="member-credits">{member.credits}</strong><Badge tone={member.membershipStatus === "APPROVED" ? "green" : "gold"}>{member.membershipStatus}</Badge></div>)}</div></section><div className="sr-only">{transactions?.length}{departments?.length}{levels?.length}{audit?.length}</div></>;
}

function Metric({ label, value, change, tone, icon }: { label: string; value: ReactNode; change: string; tone: string; icon: ReactNode }) { return <div className={`metric-card metric-${tone}`}><IconBox tone={tone as any}>{icon}</IconBox><span>{label}</span><strong>{value}</strong><small>{change}</small></div>; }

function AdminDataPage({ kind, user }: { kind: string; user: any }) {
  const [search, setSearch] = useState("");
  const { data: members, isLoading: loadingMembers } = useListPresidentMembers(search ? { search } : undefined);
  const { data: departments } = useListDepartments();
  const { data: transactions } = useListTransactions(search ? { search } : undefined);
  const { data: creditTypes } = useListCreditTypes();
  const { data: levels } = useListLevels();
  const { data: settings } = useGetSettings();
  const { data: audit } = useListAuditLogs();
  const createMember = useCreateMember();
  const updateMember = useUpdateMember();
  const createDepartment = useCreateDepartment();
  const updateDepartment = useUpdateDepartment();
  const updateCreditType = useUpdateCreditType();
  const updateLevel = useUpdateLevel();
  const createCreditType = useMutation({ mutationFn: (data: any) => postJson("/api/president/credit-types", data) });
  const createLevel = useMutation({ mutationFn: (data: any) => postJson("/api/president/levels", data) });
  const updateSettings = useUpdateSettings();
  const [showAdd, setShowAdd] = useState(false);
  const client = useQueryClient();
  const titleMap: Record<string, [string, string]> = { members: ["الأعضاء", "MEMBER DIRECTORY"], departments: ["الإدارات", "DEPARTMENT DIRECTORY"], credits: ["أنواع الرصيد", "CREDIT CATALOG"], achievements: ["الإنجازات", "ACHIEVEMENT REVIEW"], settings: ["إعدادات النادي", "CLUB SETTINGS"], audit: ["سجل التدقيق", "AUDIT TRAIL"] };
  const [title, eyebrow] = titleMap[kind] || titleMap.members;
  const invalidate = () => client.invalidateQueries();
  const toggleStatus = (member: any) => {
    const suspending = member.membershipStatus !== "INACTIVE";
    const question = suspending
      ? `هل تريد إيقاف عضوية ${member.fullName}؟`
      : `هل تريد إعادة تفعيل عضوية ${member.fullName}؟`;
    if (!window.confirm(question)) return;
    updateMember.mutate(
      { memberId: member.memberId, data: { membershipStatus: suspending ? "INACTIVE" : "APPROVED" } } as any,
      {
        onSuccess: () => { invalidate(); toast({ title: suspending ? "تم إيقاف عضوية العضو" : "تمت إعادة تفعيل العضوية" }); },
        onError: (error: any) => toast({ title: apiErrorMessage(error), variant: "destructive" }),
      },
    );
  };
  const approveMember = (member: any) => {
    updateMember.mutate(
      { memberId: member.memberId, data: { membershipStatus: "APPROVED" } } as any,
      {
        onSuccess: () => { invalidate(); toast({ title: "تم تحديث بيانات العضو" }); },
        onError: (error: any) => toast({ title: apiErrorMessage(error), variant: "destructive" }),
      },
    );
  };
  const body = kind === "members" ? (loadingMembers ? <LoadingState /> : <div className="member-table">{members?.map((member: any) => <div className="member-row" key={member.id}><span className="avatar avatar-small">{member.fullName.slice(0, 1)}</span><div><strong>{member.fullName}</strong><small>{member.email}</small></div><span className="member-level">{member.department || "—"}</span><strong className="member-credits">{member.credits}</strong><Badge tone={member.membershipStatus === "APPROVED" ? "green" : member.membershipStatus === "INACTIVE" ? "muted" : "gold"}>{member.membershipStatus}</Badge>{member.membershipStatus !== "APPROVED" && member.membershipStatus !== "INACTIVE" && <button className="icon-button" title="اعتماد العضوية" onClick={() => approveMember(member)}><Check size={15} /></button>}<button className="icon-button" title={member.membershipStatus === "INACTIVE" ? "إعادة التفعيل" : "إيقاف العضوية"} onClick={() => toggleStatus(member)}>{member.membershipStatus === "INACTIVE" ? <Check size={15} /> : <X size={15} />}</button></div>)}</div>) : kind === "departments" ? <div className="admin-cards">{departments?.map((d: any) => <div className="admin-list-card" key={d.id}><IconBox tone="plum"><BriefcaseBusiness size={19} /></IconBox><div><h3>{d.nameAr}</h3><p>{d.nameEn}{d.leader ? ` · قائد القسم: ${d.leader.name}` : ""}</p></div><Badge tone={d.active ? "green" : "muted"}>{d.active ? "ACTIVE" : "OFF"}</Badge><button className="icon-button" onClick={() => updateDepartment.mutate({ departmentId: d.id, data: { nameAr: d.nameAr, nameEn: d.nameEn, active: !d.active } } as any, { onSuccess: () => { invalidate(); toast({ title: "تم تحديث بيانات القسم" }); }, onError: (error: any) => toast({ title: apiErrorMessage(error), variant: "destructive" }) })}><Settings2 size={15} /></button></div>)}</div> : kind === "credits" ? <div className="admin-cards">{creditTypes?.map((t: any) => <div className="admin-list-card" key={t.id}><IconBox tone="gold"><Zap size={19} /></IconBox><div><h3>{t.nameAr}</h3><p>{t.nameEn} · {t.description || "—"}</p></div><strong className="credit-value">+{t.creditValue}</strong><button className="icon-button" onClick={() => updateCreditType.mutate({ data: { id: t.id, active: !t.active } } as any, { onSuccess: () => { invalidate(); toast({ title: "تم تحديث نوع الرصيد" }); }, onError: (error: any) => toast({ title: apiErrorMessage(error), variant: "destructive" }) })}><Settings2 size={15} /></button></div>)}</div> : kind === "achievements" ? <div className="admin-cards"><div className="achievement-intro"><div className="achievement-intro-mark"><ClipboardCheck size={26} /></div><div><h3>إدارة الإنجازات مركزياً غير متاحة بعد</h3><p>قادة الأقسام يمنحون الإنجازات لأعضاء أقسامهم مباشرة. لوحة مراجعة واعتماد مركزية للرئيسة ستُضاف في إصدار قادم.</p></div></div></div> : kind === "settings" ? <div className="form-panel"><div className="settings-row"><div><h3>السنة العضوية</h3><p>السنة الظاهرة على البطاقات الرقمية.</p></div><input className="settings-input" defaultValue={settings?.membershipYear || "2026–27"} onBlur={(e) => updateSettings.mutate({ data: { membershipYear: e.target.value } } as any, { onSuccess: () => { invalidate(); toast({ title: "تم حفظ الإعدادات" }); }, onError: (error: any) => toast({ title: apiErrorMessage(error), variant: "destructive" }) })} /></div><div className="settings-row"><div><h3>الملفات العامة</h3><p>السماح للأعضاء بمشاركة صفحة ملفهم العام.</p></div><input type="checkbox" defaultChecked={settings?.publicProfilesDefaultVisible} onChange={(e) => updateSettings.mutate({ data: { publicProfilesDefaultVisible: e.target.checked } } as any, { onSuccess: invalidate })} /></div><div className="sr-only">{levels?.length}{createMember.isPending}{createDepartment.isPending}{transactions?.length}{audit?.length}{user?.id}</div></div> : <div className="activity-list large-list">{audit?.map((log: any) => <div className="activity-row" key={log.id}><IconBox tone="lilac"><History size={17} /></IconBox><div className="activity-detail"><strong>{log.action}</strong><small>{log.actor} · {log.target}</small></div><span className="subtle">{log.timestamp}</span></div>)}</div>;
  return <><SectionTitle eyebrow={eyebrow} title={title} action={kind !== "settings" && kind !== "audit" && kind !== "achievements" ? <Button onClick={() => setShowAdd(true)}><Plus size={16} /> إضافة جديد</Button> : undefined} />{kind === "members" && <div className="filter-row admin-filter"><div className="search-field"><Search size={16} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ابحث بالاسم أو البريد" /></div><div className="tabs"><button className="tab active">الكل</button><button className="tab">بانتظار المراجعة</button></div></div>}<section className="panel">{body}</section>
    {showAdd && kind === "members" && <AddMemberModal departments={departments || []} loading={createMember.isPending} onClose={() => setShowAdd(false)} onSubmit={(payload) => createMember.mutate({ data: payload } as any, { onSuccess: () => { invalidate(); setShowAdd(false); toast({ title: "تمت إضافة العضو بنجاح" }); }, onError: (error: any) => toast({ title: apiErrorMessage(error, "تعذر إضافة العضو"), variant: "destructive" }) })} />}
    {showAdd && kind === "departments" && <SimpleAddModal kind={kind} onClose={() => setShowAdd(false)} onSubmit={(payload) => createDepartment.mutate({ data: payload } as any, { onSuccess: () => { invalidate(); setShowAdd(false); toast({ title: "تم إنشاء القسم" }); }, onError: (error: any) => toast({ title: apiErrorMessage(error, "تعذر إنشاء القسم"), variant: "destructive" }) })} />}
    {showAdd && kind === "credits" && <AddCreditTypeModal loading={createCreditType.isPending} onClose={() => setShowAdd(false)} onSubmit={(payload) => createCreditType.mutate(payload, { onSuccess: () => { invalidate(); setShowAdd(false); toast({ title: "تم إنشاء نوع الرصيد" }); }, onError: (error: any) => toast({ title: apiErrorMessage(error, "تعذر إنشاء نوع الرصيد"), variant: "destructive" }) })} />}
  </>;
}

function AddCreditTypeModal({ onClose, onSubmit, loading }: { onClose: () => void; onSubmit: (data: any) => void; loading: boolean }) {
  const [nameAr, setNameAr] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [creditValue, setCreditValue] = useState(10);
  const [description, setDescription] = useState("");
  const [requiresPresidentApproval, setRequiresPresidentApproval] = useState(false);
  const valid = nameAr.trim().length >= 2 && nameEn.trim().length >= 2 && creditValue > 0;
  return <div className="modal-backdrop"><div className="modal-card"><div className="modal-head"><div><p className="eyebrow">CREDIT CATALOG</p><h2>إضافة نوع رصيد</h2></div><button className="icon-button" onClick={onClose}><X size={19} /></button></div><div className="form-grid"><label className="input-label"><span>الاسم بالعربية</span><input value={nameAr} onChange={(e) => setNameAr(e.target.value)} placeholder="مثال: مشاركة خارجية" /></label><label className="input-label"><span>الاسم بالإنجليزية</span><input value={nameEn} onChange={(e) => setNameEn(e.target.value)} placeholder="External Representation" /></label><label className="input-label"><span>قيمة الرصيد</span><input type="number" min={1} value={creditValue} onChange={(e) => setCreditValue(Number(e.target.value))} /></label><label className="input-label input-wide"><span>الوصف (اختياري)</span><input value={description} onChange={(e) => setDescription(e.target.value)} /></label><label className="input-label" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}><input type="checkbox" checked={requiresPresidentApproval} onChange={(e) => setRequiresPresidentApproval(e.target.checked)} /><span>يتطلب اعتماد الرئيسة</span></label></div><div className="modal-actions"><Button variant="outline" onClick={onClose}>إلغاء</Button><Button disabled={!valid || loading} onClick={() => onSubmit({ nameAr: nameAr.trim(), nameEn: nameEn.trim(), creditValue, description: description.trim() || null, requiresPresidentApproval })}>{loading ? "جارٍ الحفظ..." : "حفظ"} <Check size={16} /></Button></div></div></div>;
}

function AddMemberModal({ departments, onClose, onSubmit, loading }: { departments: any[]; onClose: () => void; onSubmit: (data: any) => void; loading: boolean }) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [universityId, setUniversityId] = useState("");
  const [college, setCollege] = useState("");
  const [major, setMajor] = useState("");
  const [departmentId, setDepartmentId] = useState<number | "">(departments[0]?.id ?? "");
  const [role, setRole] = useState<"MEMBER" | "DEPARTMENT_LEADER">("MEMBER");
  const [membershipStatus, setMembershipStatus] = useState<"PENDING" | "APPROVED" | "REJECTED" | "INACTIVE">("APPROVED");

  const valid = fullName.trim().length >= 2 && /.+@.+\..+/.test(email) && universityId.trim() && college.trim() && major.trim() && departmentId !== "";

  return (
    <div className="modal-backdrop">
      <div className="modal-card">
        <div className="modal-head">
          <div><p className="eyebrow">MEMBER RECORD</p><h2>إضافة عضو</h2></div>
          <button className="icon-button" onClick={onClose}><X size={19} /></button>
        </div>
        <div className="form-grid">
          <label className="input-label"><span>الاسم الكامل</span><input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="مثال: سارة أحمد" /></label>
          <label className="input-label"><span>البريد الإلكتروني</span><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@imamu.edu.sa" /></label>
          <label className="input-label"><span>الرقم الجامعي</span><input value={universityId} onChange={(e) => setUniversityId(e.target.value)} placeholder="4XXXXXXXXX" /></label>
          <label className="input-label"><span>الكلية</span><input value={college} onChange={(e) => setCollege(e.target.value)} placeholder="كلية علوم الحاسب" /></label>
          <label className="input-label"><span>التخصص</span><input value={major} onChange={(e) => setMajor(e.target.value)} placeholder="نظم المعلومات" /></label>
          <label className="input-label"><span>القسم</span><select value={departmentId} onChange={(e) => setDepartmentId(Number(e.target.value))}>{departments.map((d: any) => <option key={d.id} value={d.id}>{d.nameAr}</option>)}</select></label>
          <label className="input-label"><span>الدور</span><select value={role} onChange={(e) => setRole(e.target.value as any)}><option value="MEMBER">عضو</option><option value="DEPARTMENT_LEADER">قائد قسم</option></select></label>
          <label className="input-label"><span>حالة العضوية</span><select value={membershipStatus} onChange={(e) => setMembershipStatus(e.target.value as any)}><option value="PENDING">قيد الانتظار</option><option value="APPROVED">معتمدة</option><option value="REJECTED">مرفوضة</option><option value="INACTIVE">موقوفة</option></select></label>
        </div>
        <div className="modal-actions">
          <Button variant="outline" onClick={onClose}>إلغاء</Button>
          <Button
            disabled={!valid || loading}
            onClick={() => onSubmit({ fullName: fullName.trim(), email: email.trim(), universityId: universityId.trim(), college: college.trim(), major: major.trim(), departmentId, role, membershipStatus })}
          >
            {loading ? "جارٍ الحفظ..." : "حفظ العضو"} <Check size={16} />
          </Button>
        </div>
      </div>
    </div>
  );
}

function SimpleAddModal({ kind, onClose, onSubmit }: { kind: string; onClose: () => void; onSubmit: (data: any) => void }) {
  const [nameAr, setNameAr] = useState("");
  const [nameEn, setNameEn] = useState("");
  const valid = nameAr.trim().length >= 2 && nameEn.trim().length >= 2;
  return <div className="modal-backdrop"><div className="modal-card"><div className="modal-head"><div><p className="eyebrow">CREATE RECORD</p><h2>إضافة إدارة</h2></div><button className="icon-button" onClick={onClose}><X size={19} /></button></div><div className="form-grid"><label className="input-label"><span>الاسم بالعربية</span><input value={nameAr} onChange={(e) => setNameAr(e.target.value)} /></label><label className="input-label"><span>الاسم بالإنجليزية</span><input value={nameEn} onChange={(e) => setNameEn(e.target.value)} /></label></div><div className="modal-actions"><Button variant="outline" onClick={onClose}>إلغاء</Button><Button disabled={!valid} onClick={() => onSubmit({ nameAr: nameAr.trim(), nameEn: nameEn.trim(), active: true })}>حفظ <Check size={16} /></Button></div></div></div>;
}

function AdminRoute() {
  const { isLoaded, isSignedIn } = useAuth();
  const {
    data: user,
    isLoading,
    isError,
  } = useGetMe({
    query: {
      queryKey: getGetMeQueryKey(),
      enabled: !!isSignedIn,
    },
  });

  const [location, setLocation] = useLocation();

  if (!isLoaded || isLoading) return <LoadingState />;

  if (!isSignedIn) {
    return <Redirect to="/sign-in" />;
  }

  if (isError || !user) {
    return <ErrorState />;
  }

  if (user.role !== "PRESIDENT") {
    return (
      <div className="restricted-page">
        <ShieldCheck size={32} />
        <h1>هذه المساحة للرئيس فقط</h1>
        <p>إذا كنت تعتقد أن هذا خطأ، تواصل مع إدارة PMC.</p>
        <Button onClick={() => setLocation("/app")}>
          العودة لمساحتي
        </Button>
      </div>
    );
  }

  const page =
    location === "/admin" ? (
      <AdminOverview user={user} />
    ) : (
      <AdminDataPage
        kind={location.split("/")[2] || "members"}
        user={user}
      />
    );

  return (
    <AppShell user={user} admin>
      {page}
    </AppShell>
  );
}
function ActivationPage() {
  const [fullName, setFullName] = useState(""); const [email, setEmail] = useState(""); const [checked, setChecked] = useState(false);
  const activation = useCheckActivation({ mutation: { onSuccess: () => setChecked(true) } });
  return <div className="activation-page texture"><div className="activation-card"><BrandLogo /><Badge tone="orange">MEMBER ACTIVATION</Badge><h1>هل أنت ضمن مجتمع PMC؟</h1><p>تحقق من اعتماد عضويتك قبل إنشاء حسابك في مساحة النادي.</p>{checked ? <div className="activation-success"><Check size={25} /><h3>تم العثور على عضويتك</h3><p>يمكنك الآن المتابعة لإنشاء حسابك.</p><Button onClick={() => window.location.assign(`${basePath}/sign-up`)}>متابعة التسجيل <ArrowLeft size={16} /></Button></div> : <div className="activation-form"><label className="input-label"><span>الاسم الكامل</span><input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="اكتب اسمك كما هو في العضوية" /></label><label className="input-label"><span>البريد الإلكتروني الجامعي</span><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@imamu.edu.sa" /></label><Button disabled={!fullName || !email || activation.isPending} onClick={() => activation.mutate({ data: { fullName, email } })}>تحقق من العضوية <ArrowLeft size={16} /></Button>{activation.isError && <small className="form-error">لم نجد عضوية بهذه البيانات. تأكد وحاول مرة أخرى.</small>}</div>}<a className="back-link" href={`${basePath || ""}/`}>العودة للموقع</a></div></div>;
}

function PublicMemberPage() {
  const [location] = useLocation(); const memberId = location.split("/").pop() || ""; const { data, isLoading, isError } = useGetPublicMemberProfile(memberId);
  if (isLoading) return <LoadingState />; if (isError || !data) return <ErrorState label="هذا الملف غير متاح." />;
  return <div className="public-profile-page texture"><div className="public-profile-card"><BrandLogo /><Badge tone="green">PMC VERIFIED MEMBER</Badge><span className="avatar avatar-xl">{data.name.slice(0, 1)}</span><h1>{data.name}</h1><p>{data.memberId} · {data.department || "—"}</p><div className="public-profile-level"><span>{data.level?.symbol}</span><strong>{data.level?.nameAr}</strong><small>{data.level?.nameEn}</small></div><div className="public-profile-stats"><div><strong>{data.credits}</strong><span>PMC CREDITS</span></div><div><strong>{data.achievements.length}</strong><span>ACHIEVEMENTS</span></div><div><strong>{data.memberSince}</strong><span>MEMBER SINCE</span></div></div><p className="public-profile-note">ملف موثق من نادي إدارة المشاريع بجامعة الإمام محمد بن سعود الإسلامية.</p></div></div>;
}

function HomeRedirect() {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) return <LoadingState />;
  return isSignedIn ? <Redirect to="/app" /> : <HomePage />;
}

function RoutedApp() {
  const [, setLocation] = useLocation();
  return <Switch><Route path="/" component={HomeRedirect} /><Route path="/sign-in/*?" component={() => <AuthPage />} /><Route path="/sign-up/*?" component={() => <AuthPage signUp />} /><Route path="/activate" component={ActivationPage} /><Route path="/member/:memberId" component={PublicMemberPage} /><Route path="/app/:rest*" component={() => <MemberRoute><MemberData /></MemberRoute>} /><Route path="/app" component={() => <MemberRoute><MemberData /></MemberRoute>} /><Route path="/admin/:rest*" component={AdminRoute} /><Route path="/admin" component={AdminRoute} /><Route component={NotFound} /></Switch>;
}

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();
  return <ClerkProvider publishableKey={clerkPubKey} proxyUrl={clerkProxyUrl} appearance={clerkAppearance} signInUrl={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} localization={{ signIn: { start: { title: "مرحباً بعودتك", subtitle: "سجّل دخولك للوصول إلى مساحتك" } }, signUp: { start: { title: "أنشئ حسابك", subtitle: "ابدأ ببناء أثرك اليوم" } } }} routerPush={(to) => setLocation(stripBase(to))} routerReplace={(to) => setLocation(stripBase(to))}><ClerkCacheInvalidator /><RoutedApp /></ClerkProvider>;
}

function App() {
  if (!clerkPubKey) throw new Error("Missing VITE_CLERK_PUBLISHABLE_KEY in .env file");
  return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={basePath}><ClerkProviderWithRoutes /></WouterRouter><Toaster /></TooltipProvider></QueryClientProvider>;
}

export default App;