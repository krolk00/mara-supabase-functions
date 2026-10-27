import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { SmtpClient } from "https://deno.land/x/smtp@v0.7.0/mod.ts";

serve(async (req) => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const gmailPassword = Deno.env.get('GMAIL_APP_PASSWORD')!;

  const supabase = createClient(supabaseUrl, supabaseKey);

  // 1. Pobierz maile do wysłania (status 'Oczekuje' oraz scheduled_at <= teraz)
  const { data: mailsToProcess, error } = await supabase
    .from('MARA_scheduled_mails')
    .select('*')
    .eq('status', 'Oczekuje')
    .lte('scheduled_at', new Date().toISOString())
    .limit(10);

  if (error || !mailsToProcess || mailsToProcess.length === 0) {
    return new Response(JSON.stringify({ status: 'No pending emails' }), { 
      headers: { "Content-Type": "application/json" } 
    });
  }

  // 2. Połączenie SMTP z Google Workspace
  const client = new SmtpClient();
  await client.connectTLS({
    hostname: "smtp.gmail.com",
    port: 465,
    username: "kamilkrol@mara-k2.com",
    password: gmailPassword,
  });

  for (const mail of mailsToProcess) {
    try {
      await supabase.from('MARA_scheduled_mails').update({ status: 'Wysyłanie' }).eq('id', mail.id);

      await client.send({
        from: "Kamil Król <kamilkrol@mara-k2.com>",
        to: mail.email_odbiorcy,
        subject: mail.temat,
        content: mail.tresc_spersonalizowana,
        html: mail.tresc_spersonalizowana,
      });

      await supabase.from('MARA_scheduled_mails').update({ status: 'Wysłane' }).eq('id', mail.id);
      await supabase.from('MARA_sent_logs').insert({
        scheduled_mail_id: mail.id,
        lead_id: mail.lead_id,
        template_id: mail.template_id,
        cycle_id: mail.cycle_id,
        email_odbiorcy: mail.email_odbiorcy,
        email_nadawcy: "kamilkrol@mara-k2.com",
        temat: mail.temat,
        tresc_wyslana: mail.tresc_spersonalizowana,
        linia_biznesowa: mail.linia_biznesowa
      });

    } catch (err: any) {
      await supabase.from('MARA_scheduled_mails').update({ 
        status: 'Błąd', 
        blad_opis: err?.message || String(err)
      }).eq('id', mail.id);
    }
  }

  await client.close();
  return new Response(JSON.stringify({ status: 'Success', processed: mailsToProcess.length }), { 
    headers: { "Content-Type": "application/json" } 
  });
});
