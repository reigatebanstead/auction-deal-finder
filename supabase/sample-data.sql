insert into public.lots (
  id, source, auction_house, auction_title, lot_number, title, description,
  condition_report, image_urls, start_price, estimated_resale_low,
  estimated_resale, estimated_resale_high, max_hammer_bid, expected_profit,
  confidence, recommendation, closing_at, url
) values
(
  'rosan-104','rosan-reeves','Rosan Reeves','235 lots located at Hailsham',104,
  'Canon T90 with Canon FD 15mm f/2.8 fisheye',
  'Canon T90 35mm SLR camera with rare Canon FD 15mm f/2.8 fisheye lens and handbook.',
  'Camera untested. Lens appears clear with no obvious heavy scratching or fungus.',
  '[]'::jsonb,10,480,600,720,261,180,'High','BUY',
  '2026-07-19T18:00:00+01:00',
  'https://bid.rosanreevesauctions.co.uk/auction/234-235-lots-located/lot-104-canon-t90/'
)
on conflict (id) do nothing;
