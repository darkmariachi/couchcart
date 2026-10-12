import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { errorMessage, unwrap } from '../api';
import { Focusable } from './Focusable';
import ui from './ui.module.css';

/**
 * Offers to put the launcher in Steam's library as a non-Steam game, artwork included.
 * Renders nothing on a PC without Steam. `asRow` makes it look like a row of the settings list.
 */
export function AddToSteam({ asRow = false }: { asRow?: boolean }) {
  const queryClient = useQueryClient();
  const status = useQuery({
    queryKey: ['steam'],
    queryFn: () => unwrap(window.romm.steam.status()),
    staleTime: 0,
  });
  const add = useMutation({
    mutationFn: (restartSteam: boolean) => unwrap(window.romm.steam.add({ restartSteam })),
    onSuccess: (result) => queryClient.setQueryData(['steam'], result),
    onError: () => void status.refetch(),
  });

  const steam = status.data;
  if (!steam?.installed) return null;

  // Steam only reads its list of non-Steam games when it starts, so it cannot stay open.
  const label = add.isPending
    ? 'Adding to Steam…'
    : steam.running
      ? `Close Steam and ${steam.added ? 'update the entry' : 'add Couchcart'}`
      : steam.added
        ? 'Update the Steam entry'
        : 'Add Couchcart to Steam';

  return (
    <>
      <Focusable
        {...(asRow ? { className: ui.settingRow } : { variant: 'button' as const })}
        focusKey="add-to-steam"
        disabled={add.isPending}
        onPress={() => add.mutate(steam.running)}
      >
        <span>{label}</span>
      </Focusable>
      <p className={asRow ? ui.note : ui.muted}>
        {add.isSuccess
          ? `Done. Couchcart is in your Steam library with its artwork${add.data.running ? '; Steam is starting again' : ''}.`
          : steam.added
            ? 'Couchcart is already in your Steam library. Updating puts the artwork back.'
            : steam.running
              ? 'Shows Couchcart in your Steam library and Big Picture, with artwork. Steam has to close for a moment and is started again afterwards.'
              : 'Shows Couchcart in your Steam library and Big Picture, with artwork.'}
      </p>
      {add.isError && <p className={ui.error}>{errorMessage(add.error)}</p>}
    </>
  );
}
