<script lang="ts">
  import AppIcon from "$lib/components/AppIcon.svelte";

  interface AvatarUser {
    firstName: string;
    lastName: string | null;
    photoUrl: string | null;
  }

  let {
    size = "medium",
    user,
  }: {
    size?: "medium" | "large";
    user: AvatarUser | null;
  } = $props();

  const initial = $derived(
    user?.firstName
      ? user.firstName.trim().charAt(0).toLocaleUpperCase("ru")
      : "",
  );
</script>

<span
  class={[
    "profile-avatar relative grid shrink-0 place-items-center overflow-hidden rounded-full",
    "border border-[color:var(--glass-edge)] bg-[color:var(--row-bg)] font-semibold text-[color:var(--faint)]",
    size === "large" ? "h-16 w-16 text-xl" : "h-12 w-12 text-base",
  ]}
  aria-hidden="true"
>
  {#if user?.photoUrl}
    <img
      class="h-full w-full object-cover"
      src={user.photoUrl}
      alt=""
      referrerpolicy="no-referrer"
    />
  {:else if initial}
    <span class="avatar-initial">{initial}</span>
  {:else}
    <AppIcon name="profile" size={size === "large" ? 30 : 22} />
  {/if}
</span>
