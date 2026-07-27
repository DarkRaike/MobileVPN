<script lang="ts">
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
    user: AvatarUser;
  } = $props();

  const initials = $derived(
    [user.firstName, user.lastName]
      .filter((part): part is string => Boolean(part))
      .slice(0, 2)
      .map((part) => part.trim().charAt(0).toLocaleUpperCase("ru"))
      .join(""),
  );
</script>

<span
  class={[
    "relative grid shrink-0 place-items-center overflow-hidden rounded-full bg-gradient-to-br from-[#34708b] to-[#152d38] font-bold text-white shadow-[inset_0_1px_0_rgb(255_255_255/12%)]",
    size === "large" ? "h-16 w-16 text-base" : "h-12 w-12 text-sm",
  ]}
  aria-hidden="true"
>
  {#if user.photoUrl}
    <img
      class="h-full w-full object-cover"
      src={user.photoUrl}
      alt=""
      referrerpolicy="no-referrer"
    />
  {:else}
    {initials || "A"}
  {/if}
</span>
