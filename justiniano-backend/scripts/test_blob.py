from app.integrations.blob import blob_client
c = blob_client()
print('blob client type', type(c))
# probar sas_url con un path ficticio
print('sas_url', c.sas_url('test/container.txt'))
