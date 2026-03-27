<script lang="ts">
	import { enhance } from '$app/forms';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<div class="space-y-6">
	<div>
		<h1 class="text-2xl font-semibold">Instellingen</h1>
		<p class="text-base-content/60 text-sm mt-1">
			Beheer e-mailontvangers voor back-up waarschuwingen
		</p>
	</div>

	<!-- E-mail bij succesvolle back-up -->
	<div class="card border border-base-content/10 p-4">
		<div class="flex items-center justify-between">
			<div>
				<h2 class="text-lg font-medium">E-mail bij succesvolle back-up</h2>
				<p class="text-base-content/60 text-sm mt-1">
					Stuur een bevestigingsmail naar alle ontvangers wanneer de dagelijkse back-up succesvol is
				</p>
			</div>
			<form method="POST" action="?/toggleSuccessEmail" use:enhance>
				<input type="hidden" name="enabled" value={data.emailOnSuccess ? 'false' : 'true'} />
				<input
					type="checkbox"
					class="toggle toggle-success"
					checked={data.emailOnSuccess}
					onchange={(e) => e.currentTarget.form?.requestSubmit()}
				/>
			</form>
		</div>
	</div>

	<!-- Formulier: ontvanger toevoegen -->
	<div class="card border border-base-content/10 p-4">
		<h2 class="text-lg font-medium mb-4">Ontvanger toevoegen</h2>

		{#if form?.error}
			<div class="alert alert-error mb-4 text-sm">
				{form.error}
			</div>
		{/if}

		{#if form?.success && form?.action === 'add'}
			<div class="alert alert-success mb-4 text-sm">
				Ontvanger toegevoegd
			</div>
		{/if}

		<form method="POST" action="?/add" use:enhance class="flex gap-3 items-end flex-wrap">
			<div class="form-control flex-1 min-w-[200px]">
				<label class="label" for="name">
					<span class="label-text text-sm">Naam</span>
				</label>
				<input
					type="text"
					id="name"
					name="name"
					class="input input-bordered input-sm w-full"
					placeholder="Jan Jansen"
					required
				/>
			</div>

			<div class="form-control flex-1 min-w-[250px]">
				<label class="label" for="email">
					<span class="label-text text-sm">E-mailadres</span>
				</label>
				<input
					type="email"
					id="email"
					name="email"
					class="input input-bordered input-sm w-full"
					placeholder="jan@voorbeeld.nl"
					required
				/>
			</div>

			<button type="submit" class="btn btn-sm btn-primary">
				Toevoegen
			</button>
		</form>
	</div>

	<!-- Lijst van ontvangers -->
	<div class="card border border-base-content/10 overflow-hidden">
		<div class="overflow-x-auto">
			<table class="table table-sm">
				<thead>
					<tr class="bg-base-200">
						<th>Naam</th>
						<th>E-mailadres</th>
						<th>Toegevoegd</th>
						<th class="w-20"></th>
					</tr>
				</thead>
				<tbody>
					{#each data.recipients as recipient}
						<tr class="hover:bg-base-content/5">
							<td class="text-sm">{recipient.name}</td>
							<td class="text-sm font-mono">{recipient.email}</td>
							<td class="text-sm text-base-content/60">
								{new Date(recipient.created_at).toLocaleDateString('nl-NL', { dateStyle: 'medium' })}
							</td>
							<td>
								<form method="POST" action="?/delete" use:enhance>
									<input type="hidden" name="id" value={recipient.id} />
									<button type="submit" class="btn btn-ghost btn-sm text-error hover:bg-error/10" title="Verwijder ontvanger">
										<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
											<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
										</svg>
									</button>
								</form>
							</td>
						</tr>
					{:else}
						<tr>
							<td colspan="4" class="text-center text-base-content/50 py-8">
								Geen ontvangers geconfigureerd
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</div>
</div>
