<script lang="ts">
  import { pushState, replaceState } from "$app/navigation";
  import { resolve } from "$app/paths";
  import { onMount } from "svelte";

  import type { AuthenticatedUser } from "$lib/server/auth/sessions";
  import type { getProfileOverview } from "$lib/server/modules/subscriptions/profile";
  import type {
    AppActionFeedback,
    CatalogPlan,
    FaqItem,
  } from "$lib/features/catalog/types";

  import AppIcon from "$lib/components/AppIcon.svelte";
  import HomeSection from "$lib/features/home/HomeSection.svelte";
  import ProfileSection from "$lib/features/profile/ProfileSection.svelte";
  import SupportSection from "$lib/features/support/SupportSection.svelte";
  import { getTelegramWebApp } from "$lib/telegram/web-app";

  import {
    clampSectionIndex,
    getSectionIndex,
    resolveSwipe,
    sections,
    type SectionIndex,
  } from "./navigation";

  let {
    activePlans,
    faqItems,
    feedback,
    isAdmin,
    profileOverview,
    purchasesEnabled,
    sessionExpiresAt,
    user,
  }: {
    activePlans: CatalogPlan[];
    faqItems: FaqItem[];
    feedback: AppActionFeedback | null;
    isAdmin: boolean;
    profileOverview: Awaited<ReturnType<typeof getProfileOverview>>;
    purchasesEnabled: boolean;
    sessionExpiresAt: Date | null;
    user: AuthenticatedUser;
  } = $props();

  let activeIndex = $state<SectionIndex>(1);
  let appElement: HTMLElement;
  let dragOffset = $state(0);
  let dragging = $state(false);
  let pointerId: number | null = null;
  let pointerStartX = 0;
  let pointerStartY = 0;
  let horizontalGesture = false;

  const trackTransform = $derived(
    `translate3d(calc(${-activeIndex * 100}% + ${dragOffset}px), 0, 0)`,
  );
  const indicatorTransform = $derived(
    `translate3d(${activeIndex * 100}%, 0, 0)`,
  );

  function updateUrl(index: SectionIndex, replace: boolean): void {
    const section = sections[index];
    const state = { astraSection: section.id };
    const destination =
      section.id === "home" ? resolve("/") : resolve(`/?section=${section.id}`);

    if (replace) {
      replaceState(destination, state);
    } else {
      pushState(destination, state);
    }
  }

  function focusSection(index: SectionIndex): void {
    requestAnimationFrame(() => {
      document.getElementById(`section-heading-${sections[index].id}`)?.focus({
        preventScroll: true,
      });
    });
  }

  function goTo(
    nextIndex: number,
    options: { focus?: boolean; history?: "none" | "push" | "replace" } = {},
  ): void {
    const next = clampSectionIndex(nextIndex);
    const changed = next !== activeIndex;

    activeIndex = next;
    dragOffset = 0;

    if (options.history === "push" && changed) {
      updateUrl(next, false);
    } else if (options.history === "replace") {
      updateUrl(next, true);
    }

    if (options.focus) {
      focusSection(next);
    }
  }

  function isInteractiveTarget(target: EventTarget | null): boolean {
    return (
      target instanceof Element &&
      Boolean(
        target.closest(
          "a, button, input, select, textarea, summary, [data-no-swipe]",
        ),
      )
    );
  }

  function handlePointerDown(event: PointerEvent): void {
    if (
      (event.pointerType === "mouse" && event.button !== 0) ||
      isInteractiveTarget(event.target)
    ) {
      return;
    }

    pointerId = event.pointerId;
    pointerStartX = event.clientX;
    pointerStartY = event.clientY;
    horizontalGesture = false;
    dragOffset = 0;
  }

  function handlePointerMove(event: PointerEvent): void {
    if (pointerId !== event.pointerId) {
      return;
    }

    const deltaX = event.clientX - pointerStartX;
    const deltaY = event.clientY - pointerStartY;

    if (!horizontalGesture) {
      if (Math.max(Math.abs(deltaX), Math.abs(deltaY)) < 8) {
        return;
      }

      if (Math.abs(deltaY) >= Math.abs(deltaX)) {
        pointerId = null;
        return;
      }

      horizontalGesture = true;
      dragging = true;
      appElement.setPointerCapture?.(event.pointerId);
    }

    const atBoundary =
      (activeIndex === 0 && deltaX > 0) || (activeIndex === 2 && deltaX < 0);
    dragOffset = atBoundary ? deltaX * 0.25 : deltaX;
  }

  function finishPointerGesture(event: PointerEvent): void {
    if (pointerId !== event.pointerId) {
      return;
    }

    const nextIndex =
      horizontalGesture && appElement
        ? resolveSwipe(activeIndex, dragOffset, appElement.clientWidth)
        : activeIndex;

    pointerId = null;
    horizontalGesture = false;
    dragging = false;
    dragOffset = 0;

    if (nextIndex !== activeIndex) {
      goTo(nextIndex, { history: "push" });
    }
  }

  function handleKeyboard(event: KeyboardEvent): void {
    if (
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      isInteractiveTarget(event.target)
    ) {
      return;
    }

    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      goTo(activeIndex + (event.key === "ArrowRight" ? 1 : -1), {
        focus: true,
        history: "push",
      });
    }
  }

  onMount(() => {
    const initialIndex = getSectionIndex(
      new URL(window.location.href).searchParams.get("section"),
    );

    goTo(initialIndex, { history: "none" });

    const handlePopState = () => {
      goTo(
        getSectionIndex(
          new URL(window.location.href).searchParams.get("section"),
        ),
        { history: "none" },
      );
    };

    window.addEventListener("popstate", handlePopState);
    window.addEventListener("keydown", handleKeyboard);

    return () => {
      window.removeEventListener("popstate", handlePopState);
      window.removeEventListener("keydown", handleKeyboard);
    };
  });

  $effect(() => {
    const index = activeIndex;
    const backButton = getTelegramWebApp()?.BackButton;

    if (!backButton) {
      return;
    }

    const handleBack = () => {
      goTo(1, {
        focus: true,
        history: "replace",
      });
    };

    if (index === 1) {
      backButton.hide();
      return;
    }

    backButton.show();
    backButton.onClick(handleBack);

    return () => {
      backButton.offClick(handleBack);
    };
  });
</script>

<main
  class="mini-app"
  bind:this={appElement}
  onpointerdown={handlePointerDown}
  onpointermove={handlePointerMove}
  onpointerup={finishPointerGesture}
  onpointercancel={finishPointerGesture}
>
  <div class:dragging class="section-track" style:transform={trackTransform}>
    <section
      class="section-screen"
      aria-hidden={activeIndex !== 0}
      aria-label="Поддержка"
      inert={activeIndex !== 0}
    >
      <SupportSection {faqItems} {feedback} />
    </section>

    <section
      class="section-screen"
      aria-hidden={activeIndex !== 1}
      aria-label="Главная"
      inert={activeIndex !== 1}
    >
      <HomeSection
        {feedback}
        plans={activePlans}
        {purchasesEnabled}
        {user}
        onNavigate={(index) => goTo(index, { history: "push" })}
      />
    </section>

    <section
      class="section-screen"
      aria-hidden={activeIndex !== 2}
      aria-label="Профиль"
      inert={activeIndex !== 2}
    >
      <ProfileSection
        {feedback}
        {isAdmin}
        {profileOverview}
        {sessionExpiresAt}
        {user}
        onNavigate={(index) => goTo(index, { history: "push" })}
      />
    </section>
  </div>

  <nav class="glass-nav" aria-label="Основная навигация" data-no-swipe>
    <span
      class="nav-indicator"
      style:transform={indicatorTransform}
      aria-hidden="true"
    ></span>
    <div class="relative grid grid-cols-3">
      {#each sections as section, index (section.id)}
        <button
          class:active={activeIndex === index}
          class="nav-item"
          type="button"
          aria-current={activeIndex === index ? "page" : undefined}
          onclick={(event) =>
            goTo(index, {
              focus: event.detail === 0,
              history: "push",
            })}
        >
          <AppIcon
            name={section.id === "home"
              ? "home"
              : section.id === "profile"
                ? "profile"
                : "support"}
            size={24}
          />
          <span>{section.label}</span>
        </button>
      {/each}
    </div>
  </nav>
</main>
