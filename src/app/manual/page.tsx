import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: '사용 설명서 · 차량 사용·정산',
  description: '기사·현장 담당자·정산 담당자·관리자가 실제로 쓰는 순서대로 정리한 사용 설명서',
};

/*
 * 로그인 없이 누구나 여는 사용 설명서. 주소만 문자로 보내면 된다.
 * 화면은 docs/manual/capture 스크립트로 시연 사이트에서 한 달 흐름을 진행하며 찍었다.
 */

const roles = [
  { id: 'start', label: '처음 한 번만' },
  { id: 'driver', label: '기사' },
  { id: 'site', label: '현장 담당자' },
  { id: 'settle', label: '정산 담당자' },
  { id: 'admin', label: '관리자' },
  { id: 'faq', label: '이럴 땐' },
];

function Shot({ src, alt, phone = false }: { src: string; alt: string; phone?: boolean }) {
  const image = (
    // eslint-disable-next-line @next/next/no-img-element -- 정적 캡처를 원본 그대로 보여 준다
    <img
      src={`/manual/${src}.png`}
      alt={alt}
      loading="lazy"
      width={phone ? 780 : 1440}
      height={phone ? 1688 : 900}
      className={`h-auto w-full border border-slate-300 bg-white shadow-sm ${phone ? 'rounded-[1.5rem]' : 'rounded-lg'}`}
    />
  );
  if (phone)
    return (
      <figure className="w-full max-w-[17rem] shrink-0">
        {image}
        <figcaption className="mt-2 text-center text-sm text-slate-600">{alt}</figcaption>
      </figure>
    );
  // PC 화면은 휴대폰에서 글씨가 작으므로 눌러서 원본 크기로 볼 수 있게 한다.
  return (
    <figure className="w-full">
      <a href={`/manual/${src}.png`} target="_blank" rel="noreferrer" className="block">
        {image}
      </a>
      <figcaption className="mt-2 text-center text-sm text-slate-600">
        {alt}
        <span className="md:hidden"> · 눌러서 크게 보기</span>
      </figcaption>
    </figure>
  );
}

/** 번호 단계: 글은 왼쪽, 휴대폰 화면은 오른쪽(좁으면 아래). */
function Step({
  n,
  title,
  children,
  shot,
}: {
  n?: number;
  title: string;
  children?: ReactNode;
  shot?: ReactNode;
}) {
  return (
    <li className="manual-step flex flex-col gap-5 border-t border-slate-200 py-7 md:flex-row md:items-start md:gap-10">
      <div className="min-w-0 flex-1">
        <h4 className="flex items-start gap-3 text-[1.1875rem] font-bold md:text-xl">
          {n !== undefined && (
            <span
              aria-hidden="true"
              className="num flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-signal text-lg text-ink"
            >
              {n}
            </span>
          )}
          <span className="pt-0.5">{title}</span>
        </h4>
        {children && (
          <div className="mt-3 space-y-3 text-[1.0625rem] leading-relaxed text-slate-800 md:pl-12">
            {children}
          </div>
        )}
      </div>
      {shot && <div className="flex justify-center md:w-[17rem] md:shrink-0">{shot}</div>}
    </li>
  );
}

function Scene({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-lg border-l-4 border-signal bg-white px-5 py-4 text-[1.0625rem] leading-relaxed">
      {children}
    </p>
  );
}

function Tip({ children }: { children: ReactNode }) {
  return <li className="rounded-lg bg-white px-5 py-4 leading-relaxed">{children}</li>;
}

function RoleHeader({
  id,
  role,
  title,
  children,
}: {
  id: string;
  role: string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <header className="space-y-3">
      <p className="text-sm font-bold text-slate-600">{role}</p>
      <h2
        id={id}
        className="scroll-mt-4 text-[1.5rem] md:scroll-mt-36 leading-tight font-bold md:text-[1.875rem]"
      >
        {title}
      </h2>
      {children}
    </header>
  );
}

const B = ({ children }: { children: ReactNode }) => (
  <strong className="font-bold text-ink">{children}</strong>
);

export default function ManualPage() {
  return (
    <div className="min-h-dvh bg-concrete text-ink">
      <header className="manual-bar top-0 z-10 bg-ink text-white md:sticky">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3">
          <Link href="/" className="flex min-h-11 items-center gap-2 font-bold">
            <span aria-hidden="true" className="h-5 w-1.5 rounded-sm bg-signal" />
            차량 사용·정산 사용 설명서
          </Link>
          <a
            href="/manual/vehicle-manual.pdf"
            className="inline-flex min-h-11 items-center rounded-lg bg-white/10 px-4 text-sm font-semibold hover:bg-white/20"
          >
            PDF로 받기
          </a>
        </div>
        <nav aria-label="역할별 바로가기" className="border-t border-white/10">
          <ul className="mx-auto grid max-w-5xl grid-cols-3 gap-1 px-2 py-1.5 text-[0.9375rem] whitespace-nowrap sm:flex">
            {roles.map((role) => (
              <li key={role.id}>
                <a
                  href={`#${role.id}`}
                  className="flex min-h-11 items-center justify-center rounded-md px-3 font-semibold text-slate-200 hover:bg-white/10 hover:text-white"
                >
                  {role.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </header>

      <main className="mx-auto max-w-5xl space-y-16 px-4 pt-8 pb-24 break-keep">
        <section className="space-y-5">
          <h1 className="text-[1.625rem] leading-tight font-bold md:text-[2rem]">
            운행 한 건이 돈이 되기까지
          </h1>
          <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ['기사', '운행을 마치고 휴대폰으로 보냅니다.'],
              ['현장 담당자', '들어온 운행을 확인하고 승인합니다.'],
              ['정산 담당자', '월말에 운송사별로 묶어 확정하고, 입금 후 기록합니다.'],
              ['기사', '‘내 정산’에서 들어온 돈을 확인합니다.'],
            ].map(([who, what], index) => (
              <li key={index} className="rounded-lg bg-white p-4">
                <p className="num text-sm font-bold text-slate-500">{index + 1}</p>
                <p className="mt-1 font-bold">{who}</p>
                <p className="mt-1 leading-relaxed text-slate-700">{what}</p>
              </li>
            ))}
          </ol>
          <p className="leading-relaxed text-slate-700">
            아래 화면은 시연 사이트에서 이 흐름을 처음부터 끝까지 실제로 해 보며 찍었습니다. 기사{' '}
            <B>김성호</B>(1톤 카고, 한길 운송), 현장 담당자 <B>박준호</B>, 정산 담당자 <B>최은정</B>이
            나옵니다. 본인 역할만 읽으셔도 됩니다.
          </p>
        </section>

        {/* 처음 한 번만 */}
        <section className="space-y-6">
          <RoleHeader id="start" role="모두" title="처음 한 번만" />
          <ol>
            <Step
              n={1}
              title="주소로 들어가 로그인합니다"
              shot={<Shot src="01-login" alt="로그인 화면" phone />}
            >
              <p>
                휴대폰이나 PC에서 <B>vehicle-settlement.vercel.app</B> 에 들어가, 담당자에게 받은 아이디와
                비밀번호를 넣습니다. 기사는 ‘내 운행’, 담당자는 ‘처리할 일’ 화면이 바로 열립니다.
              </p>
            </Step>
            <Step
              n={2}
              title="홈 화면에 추가해 둡니다"
              shot={<Shot src="16-text-xlarge" alt="글자를 ‘아주 크게’로 바꾼 화면" phone />}
            >
              <p>
                아이폰은 공유 버튼 → ‘홈 화면에 추가’, 안드로이드는 크롬 메뉴 → ‘홈 화면에 추가’. 다음부터
                앱처럼 한 번에 열립니다.
              </p>
              <p>
                <B>글씨가 작으면</B> 화면 위 ‘가 가 가’에서 큰 ‘가’를 누릅니다. 글씨와 버튼이 함께 커지고, 그
                휴대폰에 기억됩니다.
              </p>
            </Step>
          </ol>
        </section>

        {/* 기사 */}
        <section className="space-y-6">
          <RoleHeader id="driver" role="기사" title="김성호 씨의 하루" />

          <h3 className="text-xl font-bold md:text-2xl">운행을 마치고 차 안에서 보내기 (1분)</h3>
          <Scene>
            오후 3시. 김포 자재 물류센터에서 PVC 배관 자재 20묶음을 싣고 서울 현장 1문에 내려놓았습니다. 차를
            세우고 휴대폰을 엽니다.
          </Scene>
          <ol>
            <Step
              n={1}
              title="노란 ‘운행 등록’을 누릅니다"
              shot={<Shot src="03-driver-home" alt="기사 홈" phone />}
            >
              <p>
                어제와 같은 일이면 바로 아래 <B>지난번과 같은 운행</B>을 누르세요. 현장·경로가 미리
                채워집니다.
              </p>
              <p>주황색 카드는 담당자가 고쳐 달라고 한 건입니다(아래에서 설명).</p>
            </Step>
            <Step
              n={2}
              title="운반 내용만 적습니다"
              shot={<Shot src="05-step1-2" alt="현장·날짜와 운반 내용" phone />}
            >
              <p>
                날짜는 오늘, 현장은 담당 현장, 차량은 내 차로 이미 골라져 있습니다. 다 채운 단계는 초록 체크가
                됩니다.
              </p>
            </Step>
            <Step
              n={3}
              title="‘최근 경로’를 누릅니다"
              shot={<Shot src="06-step3-route" alt="출발 → 도착과 최근 경로" phone />}
            >
              <p>“김포 자재 물류센터 → 서울 현장 1문”을 누르면 출발·도착이 한 번에 채워집니다.</p>
              <p>
                같은 날 또 다녀왔으면 <B>+ 운행 추가</B> 또는 <B>직전 회차 복사</B>.
              </p>
            </Step>
            <Step
              n={4}
              title="인수증을 찍습니다"
              shot={<Shot src="07-step4-photo" alt="인수증 사진 첨부" phone />}
            >
              <p>
                점선 상자 <B>사진 촬영·추가</B>를 눌러 찍거나 앨범에서 고릅니다. 통신이 약해도 보낼 때 함께
                올라갑니다.
              </p>
            </Step>
            <Step
              n={5}
              title="이번 운행 금액을 확인합니다"
              shot={<Shot src="08b-amount-input" alt="이번 운행 금액 직접 입력" phone />}
            >
              <p>
                정해진 계약 단가가 있으면 금액이 자동으로 나옵니다. 조출 등으로 금액이 다르면{' '}
                <B>금액이 다르면 직접 입력</B>을 누르고 받을 금액을 적습니다(부가세 빼고).
              </p>
              <p>
                구간마다 금액이 다른 현장은 처음부터 <B>이번 운행 금액</B> 칸이 나옵니다. 최근 경로를 고르면
                지난번 그 구간 금액이 미리 채워집니다. 담당자가 확인하면 이 금액으로 확정되고, 모르면 비워
                두어도 됩니다.
              </p>
              <p>
                대기료·통행료가 있었으면 <B>+ 추가 비용</B>에 금액과 이유를 적고, 영수증도 4번에서 함께
                찍습니다.
              </p>
            </Step>
            <Step
              n={6}
              title="‘담당자에게 보내기’를 누릅니다"
              shot={<Shot src="09-confirm-sheet" alt="이대로 보낼까요? 확인 창" phone />}
            >
              <p>
                “이대로 보낼까요?” 창에 날짜·현장·차량·경로·사진 수·예상 금액이 크게 나옵니다. 맞으면{' '}
                <B>보내기</B>, 틀리면 <B>고치기</B>.
              </p>
            </Step>
            <Step
              n={7}
              title="“보냈습니다”가 나오면 끝입니다"
              shot={<Shot src="11-home-after-send" alt="보낸 뒤 내 운행 목록" phone />}
            >
              <p>
                <B>내 운행으로</B>를 누르면 방금 보낸 건이 ‘보냄 · 확인 기다림’으로 맨 위에 보입니다.
              </p>
            </Step>
          </ol>
          <ul className="grid gap-3 md:grid-cols-2">
            <Tip>
              <B>신호가 없는 곳</B>에서도 그대로 보내기를 누르세요. ‘휴대폰에만 저장됨’으로 보관됐다가 신호가
              잡히면 자동으로 보내집니다.
            </Tip>
            <Tip>
              <B>보낸 뒤 틀린 걸 발견하면</B> 담당자가 확인하기 전에는 그 건을 열어 고친 뒤 ‘수정해서 다시
              보내기’를 누르면 됩니다.
            </Tip>
          </ul>

          <h3 className="pt-6 text-xl font-bold md:text-2xl">담당자가 “고쳐 주세요”라고 할 때</h3>
          <Scene>
            다음 날 아침, 홈 화면에 주황색 <B>보완 요청</B> 카드가 생겼습니다. “9월 7일 · 현장 내 하차 위치를
            구체적으로 입력해 주세요.”
          </Scene>
          <ol>
            <Step
              n={1}
              title="카드의 ‘고치기’를 누릅니다"
              shot={<Shot src="12-fix-request" alt="보완 요청 화면" phone />}
            >
              <p>맨 위에 담당자가 보낸 요청이 주황색으로 나옵니다.</p>
            </Step>
            <Step
              n={2}
              title="요청 문장을 누릅니다"
              shot={<Shot src="13-fix-jump" alt="고칠 칸으로 이동한 모습" phone />}
            >
              <p>고쳐야 할 칸으로 바로 내려가고, 칸 옆에 요청 내용이 붙어 있습니다.</p>
            </Step>
            <Step
              n={3}
              title="고치고 다시 보냅니다"
              shot={<Shot src="14-fix-resent" alt="고쳐서 다시 보낸 모습" phone />}
            >
              <p>
                도착지를 “서울 현장 B동 뒤 자재 하치장”으로 고치고 <B>고쳐서 다시 보내기</B> → <B>보내기</B>.
                빠뜨린 영수증 사진도 이때 추가하면 됩니다.
              </p>
            </Step>
          </ol>

          <h3 className="pt-6 text-xl font-bold md:text-2xl">월말 — 돈이 들어왔는지 보기</h3>
          <ol>
            <Step
              title="아래 ‘내 정산’ 탭을 누릅니다"
              shot={<Shot src="15-my-settlement" alt="내 정산" phone />}
            >
              <p>
                맨 위에 이번 달 <B>받은 돈</B>과 <B>받을 돈</B>이 크게 나옵니다. 다른 달은 ‹ › 버튼으로
                넘깁니다.
              </p>
              <p>
                지급명세마다 ‘지급 완료’ 또는 ‘미지급’이 붙고, <B>운행 N건 자세히 보기</B>로 어떤 운행이
                들어갔는지 봅니다.
              </p>
              <p className="text-slate-600">
                본인 운행분만 보이고, 다른 기사나 원청 청구 금액은 보이지 않습니다.
              </p>
            </Step>
            <Step
              title="현장마다 얼마나 운행했는지 봅니다"
              shot={<Shot src="17-settle-projects" alt="내 정산 — 현장별" phone />}
            >
              <p>
                아래 <B>현장별</B>을 누르면 현장마다 운행 건수와 금액이 한 줄씩 나옵니다. 현장을 누르면 그
                현장 운행이 날짜순으로 펼쳐집니다.
              </p>
              <p>
                마감이 19일~다음 달 18일처럼 달 중간이면 <B>기간 직접 고르기</B>로 시작일·종료일을 정합니다.
              </p>
            </Step>
            <Step
              title="날짜별로 확인합니다"
              shot={<Shot src="18-settle-dates" alt="내 정산 — 날짜별" phone />}
            >
              <p>
                <B>날짜별</B>을 누르면 날짜마다 그날 운행과 합계가 나옵니다. 회색 ‘검수 전’ 금액은 담당자가
                아직 확인하지 않은 금액입니다.
              </p>
            </Step>
          </ol>

          <h3 className="pt-6 text-xl font-bold md:text-2xl">비밀번호를 바꾸고 싶을 때</h3>
          <ol>
            <Step
              title="홈 맨 아래 ‘비밀번호 변경’"
              shot={<Shot src="19-password-change" alt="비밀번호 변경" phone />}
            >
              <p>
                지금 비밀번호와 새 비밀번호(8자 이상)를 두 번 적고 <B>비밀번호 바꾸기</B>. 다른 휴대폰에서는
                다시 로그인해야 합니다. 담당자는 왼쪽 메뉴 아래에 같은 버튼이 있습니다.
              </p>
            </Step>
          </ol>
        </section>

        {/* 현장 담당자 */}
        <section className="space-y-6">
          <RoleHeader id="site" role="현장 담당자" title="박준호 씨의 아침 10분 검수" />
          <Shot src="20-manager-dashboard" alt="처리할 일 — 검수 대기 5건, 보완 대기 1건, 증빙 누락 2건" />
          <p className="text-[1.0625rem] leading-relaxed">
            로그인하면 <B>처리할 일</B>이 뜹니다. 숫자를 누르면 그 목록으로 바로 갑니다.
          </p>

          <h3 className="pt-4 text-xl font-bold md:text-2xl">1. 걸리는 건부터 열어 보기</h3>
          <p className="text-[1.0625rem] leading-relaxed">
            노란 <B>검수함 열기</B>를 누릅니다. 카드마다 날짜·차량·기사·경로·금액·증빙 수가 보입니다. 증빙
            없음·추가비 확인 필요처럼 볼 게 있는 건은 주황색 글씨와 <B>확인하기</B> 버튼이 붙습니다.
          </p>
          <p className="my-4">
            <B>운행 결재</B>에서는 오늘 운행을 표로 모아 봅니다. 날짜 옆 화살표로 하루씩 이동하거나
            기간·프로젝트·기사·담당자를 골라 찾으세요. 전체·작성중·검수대기·반려(보완 요청)·결재완료 탭에
            건수가 나옵니다. 검수대기 중 확인할 문제가 없는 건은 승인하거나 여러 건을 선택 승인할 수 있습니다.
            엑셀로 받기는 현재 필터의 전체 결과를 내려받습니다. 휴대폰에서는 같은 내용을 카드로 봅니다.
          </p>
          <Shot src="21-review-inbox" alt="검수함" />
          <p className="text-[1.0625rem] leading-relaxed">
            9월 7일 건은 김성호 씨가 하차 위치를 고쳐 다시 보낸 건입니다. 사용번호를 누르면 운행 실적과 인수증
            사진이 한 화면에 있습니다.
          </p>
          <Shot src="22-use-detail" alt="사용 상세" />
          <p className="text-[1.0625rem] leading-relaxed">
            아래 <B>비용 검수</B>에서 금액이 맞으면 <B>전체 승인</B>. 추가비 한 줄만 보류하려면 그 줄의 ‘검수
            결정’을 보류로 바꾸고 이유를 적습니다. 고쳐야 할 게 있으면 <B>보완 요청</B>에서 항목을 고르고
            무엇을 고칠지 적은 뒤 <B>보완 요청 보내기</B> — 그 문장이 기사 홈 화면에 그대로 뜹니다.
          </p>
          <Shot src="23-cost-review" alt="비용 검수와 보완 요청" />

          <h3 className="pt-4 text-xl font-bold md:text-2xl">2. 기사가 넣은 금액 확인하기</h3>
          <p className="text-[1.0625rem] leading-relaxed">
            기사가 운행마다 금액을 넣으면 검수함 카드에 그 금액이 그대로 나옵니다. 계약 단가와 같거나 계약이
            없으면 <B>바로 승인</B>으로 끝납니다. 계약 단가와 다르면 주황색 <B>계약 단가와 다른 금액</B>이
            붙고 <B>확인하기</B>로 열어 봅니다. 카드에 운반 내용(조출·장재물 등)도 함께 보여 금액이 다른
            이유를 바로 알 수 있습니다.
          </p>
          <Shot src="21b-inbox-differ" alt="검수함 — 계약 단가와 다른 금액" />
          <p className="text-[1.0625rem] leading-relaxed">
            비용 검수 표의 <B>요청액</B>에 기사가 넣은 금액이 나옵니다. 맞으면 승인 공급가를 비운 채{' '}
            <B>전체 승인</B> — 그 금액으로 확정됩니다. 다르게 정하려면 승인 공급가에 금액을 적습니다.
          </p>
          <Shot src="23b-cost-differ" alt="비용 검수 — 기사 요청액 확인" />

          <h3 className="pt-4 text-xl font-bold md:text-2xl">3. 나머지는 한 번에</h3>
          <p className="text-[1.0625rem] leading-relaxed">
            문제없는 건에는 노란 <B>바로 승인</B>이 있습니다. <B>문제없는 N건 모두 선택</B>을 누르면 아래에
            합계와 <B>선택 N건 승인</B> 버튼이 뜨고, 한 번 누르면 끝입니다.
          </p>
          <Shot src="26-bulk-select" alt="한 번에 선택하고 승인" />
        </section>

        {/* 정산 담당자 */}
        <section className="space-y-6">
          <RoleHeader id="settle" role="정산 담당자" title="최은정 씨의 월말 마감">
            <Scene>9월 30일. 한길 운송에 줄 9월분을 정리합니다.</Scene>
          </RoleHeader>

          <h3 className="text-xl font-bold md:text-2xl">1. 현장별·기사별로 먼저 보기</h3>
          <p className="text-[1.0625rem] leading-relaxed">
            왼쪽 메뉴 <B>현장·기사별 집계</B>. 기간을 고르고(19일~18일 마감이면 직접 입력) <B>조회하기</B>를
            누르면 현장마다 기사님별 금액, 기사님마다 현장별 금액이 나옵니다. 엑셀 마감 양식의 집계 시트와
            같은 숫자입니다.
          </p>
          <Shot src="28-summary" alt="현장·기사별 집계 — 현장별" />
          <p className="text-[1.0625rem] leading-relaxed">
            <B>한눈에 표</B>는 기사 × 현장 표에 합계가 붙어 있습니다. <B>엑셀로 받기</B>로 현장별·기사별·표 세
            장을 한 파일로 받습니다.
          </p>
          <Shot src="29-summary-table" alt="현장·기사별 집계 — 한눈에 표" />

          <h3 className="pt-4 text-xl font-bold md:text-2xl">2. 이번 달 건 묶기</h3>
          <p className="text-[1.0625rem] leading-relaxed">
            왼쪽 메뉴 <B>월 정산</B> → 노란 <B>새 정산</B>. 거래처 한길 운송, 기간은 <B>당월</B> 버튼 한 번,
            지급 예정일 10월 10일을 넣고 <B>후보 조회</B>. 승인된 비용이 줄마다 나오고 기본은 ‘포함’입니다.
            아직 승인 안 된 건은 자동으로 ‘제외’입니다.
          </p>
          <Shot src="31-candidates" alt="정산 후보 — 대기료 한 줄을 보류로 돌린 모습" />
          <ul className="grid gap-3 md:grid-cols-2">
            <Tip>
              9월 9일 대기료는 현장 확인 중이라 <B>보류</B>로 바꾸고 “대기 시간 현장 확인 중, 10월에
              정산”이라고 적었습니다. 보류한 줄은 다음 달 후보에 다시 나옵니다.
            </Tip>
            <Tip>
              사유를 비워 두면 그 칸이 빨갛게 표시되고 바로 그 자리로 이동합니다. 다 확인했으면{' '}
              <B>초안 만들기</B>.
            </Tip>
          </ul>

          <h3 className="pt-4 text-xl font-bold md:text-2xl">3. 확정하고 파일 보내기</h3>
          <p className="text-[1.0625rem] leading-relaxed">
            초안에서 합계를 확인하고 <B>명세 확정</B>을 누르면 한 번 더 묻습니다. 맞으면 <B>확정</B>.
          </p>
          <Shot src="33-confirm-step" alt="확정 확인 창" />
          <p className="text-[1.0625rem] leading-relaxed">
            문서번호(정산 기간이 끝나는 달 기준, 예: 8/19~9/18 → PAY-202609-…)가 붙고 맨 위에 ‘미지급’이
            보입니다. <B>PDF 다운로드</B> 또는 <B>엑셀 다운로드</B>로 받아 운송사에 보냅니다. PDF에는 예정일과
            보류를 뺀 합계가 찍힙니다.
          </p>
          <Shot src="34-confirmed" alt="확정된 지급명세" />
          <Shot src="35-pdf-1" alt="지급명세 PDF" />

          <h3 className="pt-4 text-xl font-bold md:text-2xl">4. 입금하고 기록하기</h3>
          <p className="text-[1.0625rem] leading-relaxed">
            이체한 뒤 같은 화면 아래 <B>지급 기록</B>에 지급일, 방법, 참고번호(이체 번호), 메모를 적고{' '}
            <B>지급 기록 저장</B>. 나눠 보냈으면 보낼 때마다 기록합니다.
          </p>
          <Shot src="36-payment-form" alt="지급 기록 입력" />
          <p className="text-[1.0625rem] leading-relaxed">
            맨 위 표시가 <B>지급 완료</B>로 바뀌고, 김성호 씨의 ‘내 정산’에도 받은 돈으로 바로 옮겨집니다.
            아직 입금 안 한 명세는 왼쪽 메뉴 <B>지급 관리</B>에서 한눈에 봅니다.
          </p>
          <Shot src="37-paid" alt="지급 완료된 명세" />
        </section>

        {/* 관리자 */}
        <section className="space-y-6">
          <RoleHeader id="admin" role="관리자" title="처음 세팅할 때">
            <p className="text-[1.0625rem] leading-relaxed">순서대로 한 번만 해 두면 됩니다.</p>
          </RoleHeader>
          <p className="text-[1.0625rem] leading-relaxed">
            처음 로그인하면 대시보드에 <B>시작 준비</B> 목록이 나옵니다. 위에서부터 누르며 등록하면 끝난
            항목에 초록 체크가 붙고, 다 끝나면 목록이 사라집니다.
          </p>
          <Shot src="43-checklist" alt="관리자 대시보드 — 시작 준비" />
          <h3 className="pt-4 text-xl font-bold">1. 기준정보</h3>
          <p className="text-[1.0625rem] leading-relaxed">
            회사 정보와 현장을 등록합니다. 현장(프로젝트) 이름을 먼저 적고, 현장 코드는 비워 두면 자동으로
            만들어집니다. 계약 단가는 정해진 단가가 있을 때만 등록합니다. 구간마다 금액이 다르면 비워 두고
            기사가 운행마다 금액을 넣게 하면 됩니다.
          </p>
          <Shot src="42-master" alt="기준정보" />
          <h3 className="pt-4 text-xl font-bold">2. 기사 가입 링크·사용자 초대</h3>
          <p>
            <B>기사관리 → 기사 가입 링크 만들기</B>에서 담당 현장과 유효기간(기본 14일)을 고릅니다. 링크
            하나를 기사님 단톡방에 보내면 각자 이름·전화·사업자·차량 정보를 입력해 가입합니다. 기사관리에서
            정보를 확인·수정하고, 링크 사용 인원을 확인하거나 링크를 끌 수 있습니다.
          </p>
          <p className="text-[1.0625rem] leading-relaxed">
            <B>사용자 초대 생성</B>에서 역할과 담당 현장을 고르면 초대 링크가 나옵니다. 그 링크를 문자로
            보내면 받은 사람이 직접 비밀번호를 정합니다. 비밀번호를 잊은 사람에게는 그 사람 옆의 ‘비밀번호
            재설정 링크 만들기’로 링크를 보냅니다.
          </p>
          <Shot src="41-users" alt="사용자 관리" />
          <h3 className="pt-4 text-xl font-bold">3. 기사가 적을 칸 줄이기</h3>
          <p className="text-[1.0625rem] leading-relaxed">
            <B>입력 항목 설정</B>에서 항목마다 숨김·선택·필수를 고릅니다. 숨긴 항목은 기사 화면에 아예 나오지
            않습니다. 현장마다 다르게 할 수도 있고, 바꾼 뒤 아래 <B>설정 저장</B>을 누릅니다.
          </p>
          <Shot src="40-form-fields" alt="입력 항목 설정" />
        </section>

        {/* 이럴 땐 */}
        <section className="space-y-6">
          <RoleHeader id="faq" role="모두" title="이럴 땐 이렇게" />
          <div className="rounded-lg bg-white">
            <table className="w-full text-left">
              <thead className="hidden bg-slate-50 text-sm text-slate-600 md:table-header-group">
                <tr>
                  <th className="px-4 py-3">화면에 보이는 말</th>
                  <th className="px-4 py-3">뜻</th>
                  <th className="px-4 py-3">누가 무엇을</th>
                </tr>
              </thead>
              <tbody className="block divide-y divide-slate-100 md:table-row-group">
                {[
                  ['작성 중 · 아직 안 보냄', '기사가 쓰다 멈춤', '기사가 열어서 보내기'],
                  ['휴대폰에만 저장됨', '신호가 없어 휴대폰에 보관 중', '신호가 잡히면 자동 전송'],
                  ['보냄 · 확인 기다림', '현장 담당자 확인 대기', '담당자가 승인 또는 보완 요청'],
                  ['고쳐서 다시 보내기', '담당자가 고칠 점을 보냄', '기사가 고쳐서 다시 보내기'],
                  ['승인됨', '정산 대상이 됨', '정산 담당자가 월말에 묶음'],
                  ['보류', '이번 달 정산에서 빠짐', '다음 달 후보에 다시 나옴'],
                  ['미지급 / 지급 완료', '확정된 명세의 입금 여부', '정산 담당자가 지급 기록'],
                ].map(([word, meaning, todo]) => (
                  <tr key={word} className="block px-4 py-3 md:table-row md:p-0">
                    <td className="block font-bold md:table-cell md:px-4 md:py-3">{word}</td>
                    <td className="block text-slate-700 md:table-cell md:px-4 md:py-3 md:text-ink">
                      {meaning}
                    </td>
                    <td className="block text-slate-700 md:table-cell md:px-4 md:py-3 md:text-ink">
                      <span className="md:hidden">→ </span>
                      {todo}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <dl className="grid gap-3 md:grid-cols-2">
            {[
              [
                '영수증 사진을 빠뜨렸어요',
                '담당자가 확인하기 전이면 그 건을 열어 사진을 추가하고 ‘수정해서 다시 보내기’. 이미 보완 요청이 왔다면 고치기 화면에서 추가합니다.',
              ],
              [
                '같은 날 여러 번 다녀왔어요',
                '한 건으로 등록하고 ‘출발 → 도착’에서 + 운행 추가를 누르세요. 일대 요금은 회차 수와 상관없이 하루 한 번 계산됩니다.',
              ],
              [
                '승인한 걸 취소하고 싶어요',
                '정산에 들어가기 전이면 관리자에게 문의하세요. 확정된 명세는 지급 전에만 명세 취소를 할 수 있고, 지급 후에는 다음 달에 조정 금액으로 반영합니다.',
              ],
              [
                '운행마다 금액이 달라요',
                '계약 단가를 등록하지 않으면 기사가 운행마다 ‘이번 운행 금액’을 넣고, 현장 담당자가 확인하면 그 금액으로 확정됩니다. 같은 구간은 지난번 금액이 미리 채워집니다.',
              ],
              [
                '비밀번호를 잊었어요',
                '관리자에게 말하면 사용자 관리에서 비밀번호 재설정 링크를 보내 드립니다. 로그인한 상태라면 메뉴의 ‘비밀번호 변경’에서 직접 바꿀 수 있습니다. 기사는 홈 맨 아래에 있습니다.',
              ],
            ].map(([q, a]) => (
              <div key={q} className="rounded-lg bg-white px-5 py-4">
                <dt className="font-bold">{q}</dt>
                <dd className="mt-1.5 leading-relaxed text-slate-700">{a}</dd>
              </div>
            ))}
          </dl>
        </section>

        <p className="text-center">
          <Link
            href="/login"
            className="inline-flex min-h-14 items-center rounded-lg bg-signal px-8 text-lg font-bold text-ink shadow-[0_2px_0_var(--color-signal-strong)]"
          >
            로그인하러 가기
          </Link>
        </p>
      </main>
    </div>
  );
}
