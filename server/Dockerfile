# Multi-stage build: compile then run on minimal runtime image
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

COPY server.csproj ./
RUN dotnet restore

COPY . ./
RUN dotnet publish -c Release -o /app/publish

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app

COPY --from=build /app/publish ./

RUN mkdir -p /data
ENV DATA_DIR=/data

EXPOSE 3000
ENTRYPOINT ["dotnet", "server.dll"]
