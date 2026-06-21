# This tells the AI to look inside the 'pdfs' folder for all .pdf files
loader = DirectoryLoader('./pdfs', glob="./*.pdf", loader_cls=PyPDFLoader)
documents = loader.load()

